// "Teams" tab: situational play-calling + EPA splits, computed directly
// from play-by-play (not model output), plus each offense's predictability
// rank from the model's held-out test season.

const Teams = (() => {
  let splits = null;
  let predictability = null;
  let side = "offense";

  const teamSelect = () => document.getElementById("teams-team");
  const logoImg = () => document.getElementById("teams-logo");

  async function init() {
    [splits, predictability] = await Promise.all([
      NFLData.loadTeamSplits(),
      NFLData.loadTeamPredictability(),
    ]);

    const abbrs = Object.keys(splits.offense).sort((a, b) => {
      const ta = NFLData.team(a), tb = NFLData.team(b);
      return (ta ? ta.name : a).localeCompare(tb ? tb.name : b);
    });
    teamSelect().innerHTML = abbrs
      .map((abbr) => {
        const t = NFLData.team(abbr);
        return `<option value="${abbr}">${t ? t.name : abbr}</option>`;
      })
      .join("");

    teamSelect().addEventListener("change", render);
    document.querySelectorAll("#teams-side-toggle button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#teams-side-toggle button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        side = btn.dataset.side;
        render();
      });
    });

    render();
  }

  function render() {
    const abbr = teamSelect().value;
    const t = NFLData.team(abbr);
    logoImg().src = t ? t.logo : "";

    const block = splits[side][abbr];
    const league = splits.league;
    if (!block) return;

    renderPredictability(abbr);

    document.getElementById("teams-by-down").innerHTML = ["1", "2", "3", "4"]
      .map((d) => renderSplitRow(`${ordinal(Number(d))} down`, block.by_down[d], league.by_down[d]))
      .join("");

    document.getElementById("teams-by-distance").innerHTML = ["short", "medium", "long"]
      .map((k) => renderSplitRow(distanceLabel(k), block.by_distance[k], league.by_distance[k]))
      .join("");

    const situationRows = [
      ["redzone", "Red zone (≤20)"],
      ["two_minute", "Two-minute drill"],
      ["trailing", "Trailing"],
      ["leading", "Leading"],
      ["tied", "Tied"],
    ];
    document.getElementById("teams-by-situation").innerHTML = situationRows
      .map(([key, label]) => renderSplitRow(label, block[key], league[key]))
      .join("");
  }

  function distanceLabel(k) {
    if (k === "short") return "Short (1–4)";
    if (k === "medium") return "Medium (5–8)";
    return "Long (9+)";
  }

  function renderPredictability(abbr) {
    const row = predictability.find((r) => r.team === abbr);
    const el = document.getElementById("teams-predictability");
    if (!row) {
      el.innerHTML = `<p class="empty-note">Not enough held-out plays for this team in the 2025 test season.</p>`;
      return;
    }
    el.innerHTML = `
      <div class="stat">
        <div class="value">${row.predictability_rank} <span style="font-size:16px;color:var(--ink-muted)">/ ${predictability.length}</span></div>
        <div class="label">predictability rank (1 = most predictable)</div>
      </div>
      <div class="stat">
        <div class="value">${Math.round(row.accuracy * 100)}%</div>
        <div class="label">model accuracy vs. this offense</div>
      </div>
      <div class="stat">
        <div class="value">${row.log_loss.toFixed(3)}</div>
        <div class="label">log-loss (lower = more predictable)</div>
      </div>
      <div class="stat">
        <div class="value">${row.n_plays}</div>
        <div class="label">plays evaluated (2025)</div>
      </div>
    `;
  }

  return { init };
})();
