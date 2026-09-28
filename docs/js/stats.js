// "Stats" tab: a custom stat calculator over every 2023-2025 play, filtered
// and aggregated entirely client-side against the same flattened play data
// the Situation tab's comparables search uses (shared cache, one fetch).

const Stats = (() => {
  const FIELD_BUCKETS = [
    [0, 20, "redzone"],
    [20, 40, "plus_territory"],
    [40, 60, "midfield"],
    [60, 80, "own_territory"],
    [80, 101, "own_deep"],
  ];
  const MIN_SAMPLE = 15;

  let allPlays = null;
  let lastRows = null;

  const $ = (id) => document.getElementById(id);

  async function init() {
    const teamAbbrs = Object.keys((await NFLData.loadTeamSplits()).offense).sort((a, b) => {
      const ta = NFLData.team(a), tb = NFLData.team(b);
      return (ta ? ta.name : a).localeCompare(tb ? tb.name : b);
    });
    const options = teamAbbrs.map((abbr) => {
      const t = NFLData.team(abbr);
      return `<option value="${abbr}">${t ? t.name : abbr}</option>`;
    }).join("");
    $("calc-team").insertAdjacentHTML("beforeend", options);
    $("calc-opp").insertAdjacentHTML("beforeend", options);

    $("calc-distance").addEventListener("input", () => {
      $("calc-distance-val").textContent = $("calc-distance").value;
    });

    $("calc-run").addEventListener("click", runQuery);
    $("calc-export").addEventListener("click", exportCsv);
    $("calc-copy-link").addEventListener("click", copyLink);

    applyFiltersFromUrl();
  }

  function fieldBucket(yardline100) {
    for (const [lo, hi, name] of FIELD_BUCKETS) {
      if (yardline100 >= lo && yardline100 < hi) return name;
    }
    return "own_deep";
  }

  function currentFilters() {
    return {
      team: $("calc-team").value,
      opp: $("calc-opp").value,
      down: $("calc-down").value,
      minDistance: Number($("calc-distance").value),
      field: $("calc-field").value,
      score: $("calc-score").value,
      quarter: $("calc-quarter").value,
      playtype: $("calc-playtype").value,
    };
  }

  function applyFilters(filters, values) {
    $("calc-team").value = values.team || "ANY";
    $("calc-opp").value = values.opp || "ANY";
    $("calc-down").value = values.down || "ANY";
    $("calc-distance").value = values.minDistance || "0";
    $("calc-distance-val").textContent = $("calc-distance").value;
    $("calc-field").value = values.field || "ANY";
    $("calc-score").value = values.score || "ANY";
    $("calc-quarter").value = values.quarter || "ANY";
    $("calc-playtype").value = values.playtype || "ANY";
  }

  function matchesFilters(p, f) {
    if (f.team !== "ANY" && p.posteam !== f.team) return false;
    if (f.opp !== "ANY" && p.defteam !== f.opp) return false;
    if (f.down !== "ANY" && p.down !== Number(f.down)) return false;
    if (p.ydstogo < f.minDistance) return false;
    if (f.field !== "ANY" && fieldBucket(p.yardline_100) !== f.field) return false;
    if (f.score === "trailing" && !(p.score_differential < 0)) return false;
    if (f.score === "leading" && !(p.score_differential > 0)) return false;
    if (f.score === "tied" && p.score_differential !== 0) return false;
    if (f.quarter !== "ANY" && p.qtr !== Number(f.quarter)) return false;
    if (f.playtype !== "ANY" && p.actual !== f.playtype) return false;
    return true;
  }

  function summarize(rows) {
    const n = rows.length;
    if (n === 0) return { n: 0 };
    const passN = rows.filter((r) => r.actual === "pass").length;
    const withYards = rows.filter((r) => r.yards_gained != null);
    const withEpa = rows.filter((r) => r.epa != null);
    return {
      n,
      pass_rate: passN / n,
      avg_yards: withYards.length ? withYards.reduce((s, r) => s + r.yards_gained, 0) / withYards.length : null,
      avg_epa: withEpa.length ? withEpa.reduce((s, r) => s + r.epa, 0) / withEpa.length : null,
      success_rate: withEpa.length ? withEpa.filter((r) => r.epa > 0).length / withEpa.length : null,
      low_sample: n < MIN_SAMPLE,
    };
  }

  async function runQuery() {
    $("calc-run").disabled = true;
    $("calc-status").textContent = "Loading 2023–2025 plays…";
    if (!allPlays) allPlays = await NFLData.loadAllPlays();
    $("calc-status").textContent = "";
    $("calc-run").disabled = false;

    const filters = currentFilters();
    const rows = allPlays.filter((p) => matchesFilters(p, filters));
    lastRows = rows;

    const summary = summarize(rows);
    renderSummary(summary);
    renderByDown(rows);

    $("calc-results").hidden = false;
    $("calc-export").disabled = rows.length === 0;
    $("calc-copy-link").disabled = false;
    $("calc-status").textContent = summary.low_sample ? `LOW SAMPLE — n=${summary.n}` : "";
  }

  function renderSummary(s) {
    if (s.n === 0) {
      $("calc-stats").innerHTML = `<p class="empty-note">No plays match these filters.</p>`;
      return;
    }
    const fmt = (v, digits = 1) => (v == null ? "—" : v.toFixed(digits));
    $("calc-stats").innerHTML = `
      <div class="stat"><div class="value">${s.n.toLocaleString()}</div><div class="label">plays${s.low_sample ? " (low sample)" : ""}</div></div>
      <div class="stat"><div class="value">${Math.round(s.pass_rate * 100)}%</div><div class="label">pass rate</div></div>
      <div class="stat"><div class="value">${fmt(s.avg_yards)}</div><div class="label">avg yards/play</div></div>
      <div class="stat"><div class="value">${fmt(s.avg_epa, 3)}</div><div class="label">EPA/play</div></div>
      <div class="stat"><div class="value">${s.success_rate == null ? "—" : Math.round(s.success_rate * 100) + "%"}</div><div class="label">success rate</div></div>
    `;
  }

  function renderByDown(rows) {
    const byDown = [1, 2, 3, 4].map((d) => ({ down: d, s: summarize(rows.filter((r) => r.down === d)) }));
    document.querySelector("#calc-by-down tbody").innerHTML = byDown
      .filter(({ s }) => s.n > 0)
      .map(({ down, s }) => `
        <tr>
          <td>${ordinal(down)}</td>
          <td>${s.n.toLocaleString()}${s.low_sample ? ' <span class="low-sample-tag">low n</span>' : ""}</td>
          <td>${Math.round(s.pass_rate * 100)}%</td>
          <td>${s.avg_yards == null ? "—" : s.avg_yards.toFixed(1)}</td>
          <td>${s.avg_epa == null ? "—" : s.avg_epa.toFixed(3)}</td>
          <td>${s.success_rate == null ? "—" : Math.round(s.success_rate * 100) + "%"}</td>
        </tr>
      `).join("");
  }

  function exportCsv() {
    if (!lastRows || !lastRows.length) return;
    const cols = ["season", "week", "game_id", "posteam", "defteam", "down", "ydstogo", "yardline_100", "qtr", "score_differential", "actual", "yards_gained", "epa", "desc"];
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [cols.join(",")];
    for (const r of lastRows) lines.push(cols.map((c) => esc(r[c])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nfl-stat-query-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function filtersToParams(f) {
    const params = new URLSearchParams();
    params.set("view", "stats");
    for (const [k, v] of Object.entries(f)) {
      if (v !== "ANY" && v !== 0 && v !== "0") params.set(k, v);
    }
    return params;
  }

  function copyLink() {
    const params = filtersToParams(currentFilters());
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    history.replaceState(null, "", `?${params.toString()}`);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        $("calc-status").textContent = "Link copied.";
        setTimeout(() => { if ($("calc-status").textContent === "Link copied.") $("calc-status").textContent = ""; }, 2500);
      }).catch(() => { $("calc-status").textContent = url; });
    } else {
      $("calc-status").textContent = url;
    }
  }

  function applyFiltersFromUrl() {
    const params = new URLSearchParams(location.search);
    if (params.get("view") !== "stats") return;
    applyFilters(null, {
      team: params.get("team"),
      opp: params.get("opp"),
      down: params.get("down"),
      minDistance: params.get("minDistance"),
      field: params.get("field"),
      score: params.get("score"),
      quarter: params.get("quarter"),
      playtype: params.get("playtype"),
    });
    const tabBtn = document.querySelector('.tab-btn[data-view="stats"]');
    if (tabBtn) tabBtn.click();
    runQuery();
  }

  return { init };
})();
