// "Situation" tab: the reinvented core experience. A single football
// situation - either hand-built or scrubbed from a real game - drives a
// field visualization, a live play-call distribution, a real evidence
// panel, a what-if comparator, and a historical-comparables search. Every
// number is computed from the same model.js scorer and team_splits.json
// used elsewhere on the site - nothing here is fabricated.

const Situation = (() => {
  const COMMON_PERSONNEL = ["11", "12", "21", "22", "10", "13", "20", "23", "01", "02"];
  const FIELD_BUCKETS = [
    [0, 20, "redzone"],
    [20, 40, "plus_territory"],
    [40, 60, "midfield"],
    [60, 80, "own_territory"],
    [80, 101, "own_deep"],
  ];
  const DISTANCE_BUCKETS = [[0, 4, "short"], [4, 8, "medium"], [8, 100, "long"]];

  let mode = "build";
  let teamAbbrs = [];
  let teamSplits = null;
  let simTables = null;
  let seasonGamesCache = {};
  let scrubState = { season: null, gameId: null, game: null, index: 0 };
  let allPlaysCache = null;

  // ---- element getters ----
  const $ = (id) => document.getElementById(id);

  async function init() {
    [teamSplits, simTables] = await Promise.all([NFLData.loadTeamSplits(), NFLData.loadSimTables()]);
    teamAbbrs = Object.keys(teamSplits.offense).sort((a, b) => {
      const ta = NFLData.team(a), tb = NFLData.team(b);
      return (ta ? ta.name : a).localeCompare(tb ? tb.name : b);
    });

    const teamOptions = teamAbbrs.map((abbr) => {
      const t = NFLData.team(abbr);
      return `<option value="${abbr}">${t ? t.name : abbr}</option>`;
    }).join("");
    $("sit-team").innerHTML = teamOptions;
    $("sit-opp").innerHTML = teamOptions;
    $("sit-team").value = "KC";
    $("sit-opp").value = "BUF";

    const personnelOptions = COMMON_PERSONNEL.map((c) => `<option value="${c}" ${c === "11" ? "selected" : ""}>${c} personnel</option>`).join("");
    $("sit-personnel").innerHTML = personnelOptions;

    wireModeToggle();
    wireBuildControls();
    await wireScrubControls();
    wireWhatIf();
    wireComparables();

    render();
  }

  // ---------------------------------------------------------------- mode

  function wireModeToggle() {
    document.querySelectorAll("#situation-mode-toggle button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#situation-mode-toggle button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        mode = btn.dataset.mode;
        $("situation-build-controls").style.display = mode === "build" ? "" : "none";
        $("situation-scrub-controls").style.display = mode === "scrub" ? "" : "none";
        render();
      });
    });
  }

  // ------------------------------------------------------- build controls

  function wireBuildControls() {
    const ids = ["sit-team", "sit-opp", "sit-down", "sit-distance", "sit-yardline", "sit-qtr", "sit-clock", "sit-scorediff", "sit-personnel"];
    ids.forEach((id) => $(id).addEventListener("input", () => { syncBuildLabels(); render(); }));
    syncBuildLabels();
  }

  function syncBuildLabels() {
    $("sit-distance-val").textContent = $("sit-distance").value;
    $("sit-yardline-val").textContent = yardlineLabel(Number($("sit-yardline").value));
    $("sit-clock-val").textContent = secondsToClock(Number($("sit-clock").value));
    const sd = Number($("sit-scorediff").value);
    $("sit-scorediff-val").textContent = sd > 0 ? `+${sd}` : `${sd}`;
  }

  function yardlineLabel(yardline100) {
    return yardline100 <= 50 ? `Opp ${yardline100}` : `Own ${100 - yardline100}`;
  }

  function secondsToClock(s) {
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${mm}:${String(ss).padStart(2, "0")}`;
  }

  function situationFromBuild() {
    const qtr = Number($("sit-qtr").value);
    const clockInQtr = Number($("sit-clock").value);
    const gameSecondsRemaining = (4 - qtr) * 900 + clockInQtr;
    return {
      offense: $("sit-team").value,
      defense: $("sit-opp").value,
      down: Number($("sit-down").value),
      ydstogo: Number($("sit-distance").value),
      yardline_100: Number($("sit-yardline").value),
      qtr,
      game_seconds_remaining: gameSecondsRemaining,
      score_differential: Number($("sit-scorediff").value),
      personnel_group: $("sit-personnel").value,
      offense_score: null,
      defense_score: null,
      real: false,
    };
  }

  // ------------------------------------------------------- scrub controls

  async function wireScrubControls() {
    const gamesIndex = await NFLData.loadGamesIndex();
    const seasons = [...new Set(gamesIndex.map((g) => g.season))].sort((a, b) => b - a);
    $("scrub-season").innerHTML = seasons.map((s) => `<option value="${s}">${s}</option>`).join("");
    $("scrub-season").addEventListener("change", () => populateScrubGames(gamesIndex));
    $("scrub-game").addEventListener("change", () => loadScrubGame());
    $("scrub-slider").addEventListener("input", () => {
      scrubState.index = Number($("scrub-slider").value);
      render();
    });
    populateScrubGames(gamesIndex);
    await loadScrubGame();
  }

  function populateScrubGames(gamesIndex) {
    const season = Number($("scrub-season").value);
    const games = gamesIndex.filter((g) => g.season === season).sort((a, b) => a.week - b.week);
    $("scrub-game").innerHTML = games.map((g) =>
      `<option value="${g.game_id}">Wk ${g.week}: ${g.away_team} ${g.away_score ?? ""} @ ${g.home_team} ${g.home_score ?? ""}</option>`
    ).join("");
  }

  async function loadScrubGame(gameIdOverride, playIndex) {
    const season = Number($("scrub-season").value);
    const gameId = gameIdOverride || $("scrub-game").value;
    if (!seasonGamesCache[season]) {
      seasonGamesCache[season] = await NFLData.loadSeasonGames(season);
    }
    const game = seasonGamesCache[season].find((g) => g.game_id === gameId);
    if (!game) return;
    scrubState = { season, gameId, game, index: playIndex ?? 0, drives: computeDrives(game) };
    $("scrub-slider").max = String(Math.max(0, game.plays.length - 1));
    $("scrub-slider").value = String(scrubState.index);
    render();
  }

  // Groups a game's plays (already in play order) into real NFL drives
  // using nflverse's own fixed_drive id, so the timeline reflects actual
  // possessions rather than an invented grouping.
  function computeDrives(game) {
    const drives = [];
    let current = null;
    game.plays.forEach((p, idx) => {
      if (!current || current.driveId !== p.drive) {
        current = {
          driveId: p.drive,
          posteam: p.posteam,
          result: p.drive_result,
          startIndex: idx,
          endIndex: idx,
          startYardline: p.yardline_100,
        };
        drives.push(current);
      } else {
        current.endIndex = idx;
      }
    });
    return drives;
  }

  function activeDrive() {
    if (!scrubState.drives) return null;
    return scrubState.drives.find((d) => scrubState.index >= d.startIndex && scrubState.index <= d.endIndex) || scrubState.drives[0];
  }

  function driveResultClass(result) {
    if (!result) return "";
    if (["Touchdown", "Field goal"].includes(result)) return "score";
    if (["Turnover", "Turnover on downs", "Opp touchdown"].includes(result)) return "turnover";
    return "";
  }

  function renderDriveTimeline() {
    const drives = scrubState.drives;
    if (!drives) return;
    const active = activeDrive();
    $("game-drive-timeline").innerHTML = drives.map((d) => `
      <button class="drive-seg ${active && d.driveId === active.driveId ? "active" : ""}" data-start="${d.startIndex}">
        <div class="ds-team">${escapeHtml(d.posteam)}</div>
        <div class="ds-result ${driveResultClass(d.result)}">${escapeHtml(d.result || "—")}</div>
        <div class="ds-meta">${d.endIndex - d.startIndex + 1} plays · ${yardlineLabel(d.startYardline)}</div>
      </button>
    `).join("");
    $("game-drive-timeline").querySelectorAll(".drive-seg").forEach((btn) => {
      btn.addEventListener("click", () => {
        scrubState.index = Number(btn.dataset.start);
        $("scrub-slider").value = String(scrubState.index);
        render();
      });
    });
  }

  function renderPlayList() {
    const drive = activeDrive();
    if (!drive) { $("game-play-list").innerHTML = ""; return; }
    $("game-drive-heading").textContent = `Plays — ${drive.posteam} drive, ${drive.result || "in progress"}`;
    const rows = [];
    for (let i = drive.startIndex; i <= drive.endIndex; i++) {
      const p = scrubState.game.plays[i];
      rows.push(`
        <div class="play-list-row ${i === scrubState.index ? "active" : ""}" data-index="${i}">
          <span class="down-dist">${ordinal(p.down)} &amp; ${p.ydstogo}</span>
          <span>${escapeHtml(p.desc || `${p.posteam} ${p.actual}`)}</span>
          <span class="predicted ${p.actual}">${p.actual === "pass" ? "PASS" : "RUN"}${p.yards_gained != null ? " " + (p.yards_gained >= 0 ? "+" : "") + p.yards_gained : ""}</span>
        </div>
      `);
    }
    $("game-play-list").innerHTML = rows.join("");
    $("game-play-list").querySelectorAll(".play-list-row").forEach((row) => {
      row.addEventListener("click", () => {
        scrubState.index = Number(row.dataset.index);
        $("scrub-slider").value = String(scrubState.index);
        render();
      });
    });
  }

  function situationFromScrub() {
    const game = scrubState.game;
    if (!game || !game.plays.length) return null;
    const p = game.plays[Math.min(scrubState.index, game.plays.length - 1)];
    const offenseIsHome = p.posteam === game.home_team;
    return {
      offense: p.posteam,
      defense: p.defteam,
      down: p.down,
      ydstogo: p.ydstogo,
      yardline_100: p.yardline_100,
      qtr: p.qtr,
      game_seconds_remaining: p.game_seconds_remaining,
      score_differential: p.score_differential,
      personnel_group: p.personnel_group,
      offense_score: offenseIsHome ? p.home_score : p.away_score,
      defense_score: offenseIsHome ? p.away_score : p.home_score,
      home_team: game.home_team,
      away_team: game.away_team,
      home_score: p.home_score,
      away_score: p.away_score,
      actual: p.actual,
      real: true,
    };
  }

  // ----------------------------------------------------------- situation

  function currentSituation() {
    return mode === "build" ? situationFromBuild() : situationFromScrub();
  }

  function fieldBucket(yardline100) {
    for (const [lo, hi, name] of FIELD_BUCKETS) {
      if (yardline100 >= lo && yardline100 < hi) return name;
    }
    return "own_deep";
  }

  function distanceBucket(ydstogo) {
    for (const [lo, hi, name] of DISTANCE_BUCKETS) {
      if (ydstogo > lo && ydstogo <= hi) return name;
    }
    return "short";
  }

  // -------------------------------------------------------------- render

  function render() {
    const sit = currentSituation();
    if (!sit) return;

    if (mode === "scrub" && scrubState.game) {
      const p = scrubState.game.plays[Math.min(scrubState.index, scrubState.game.plays.length - 1)];
      $("scrub-position").textContent = `Play ${scrubState.index + 1} of ${scrubState.game.plays.length}`;
      const predicted = NFLModel.predictPassProbability(sit) >= 0.5 ? "pass" : "run";
      $("scrub-accuracy").textContent = `model would have called ${predicted.toUpperCase()} — actually ${p.actual.toUpperCase()} ${predicted === p.actual ? "✓" : "✗"}`;
      renderDriveTimeline();
      renderPlayList();
    } else {
      $("scrub-position").textContent = "";
      $("scrub-accuracy").textContent = "";
    }

    renderStateBar(sit);
    renderField(sit);
    renderSpectrum(sit);
    renderDriveNote(sit);
    renderWhy(sit);
  }

  function renderStateBar(sit) {
    const off = NFLData.team(sit.offense);
    const def = NFLData.team(sit.defense);
    const twoMinute = [2, 4].includes(sit.qtr) && (sit.game_seconds_remaining % 900) <= 120;
    const scoreHtml = sit.real
      ? `<div class="state-score">${sit.away_score}</div>`
      : `<div class="state-score" style="font-size:20px;color:var(--ink-muted)">&mdash;</div>`;
    const scoreHtmlHome = sit.real
      ? `<div class="state-score">${sit.home_score}</div>`
      : `<div class="state-score" style="font-size:20px;color:var(--ink-muted)">&mdash;</div>`;

    const awayAbbr = sit.real ? sit.away_team : sit.defense;
    const homeAbbr = sit.real ? sit.home_team : sit.offense;
    const awayTeam = NFLData.team(awayAbbr);
    const homeTeam = NFLData.team(homeAbbr);

    $("state-bar").innerHTML = `
      <div class="state-team away">
        ${teamLogoImg(awayAbbr)}
        <div>${sit.real ? scoreHtml : ""}<div class="state-abbr">${awayAbbr}${!sit.real && sit.defense === awayAbbr ? " (defense)" : ""}</div></div>
      </div>
      <div class="state-center">
        <div class="state-downdist">${ordinal(sit.down)} &amp; ${sit.ydstogo}</div>
        <div class="state-clock">Q${sit.qtr}  ${formatClock(sit.game_seconds_remaining).clock}  ·  ${yardlineLabel(sit.yardline_100)}</div>
        <div class="state-flags">
          ${!sit.real ? `<span class="state-flag">${sit.score_differential > 0 ? "+" : ""}${sit.score_differential} for offense</span>` : ""}
          ${twoMinute ? `<span class="state-flag warn">2-MINUTE</span>` : ""}
          ${sit.yardline_100 <= 20 ? `<span class="state-flag">RED ZONE</span>` : ""}
        </div>
      </div>
      <div class="state-team home">
        ${teamLogoImg(homeAbbr)}
        <div>${sit.real ? scoreHtmlHome : ""}<div class="state-abbr">${homeAbbr}${!sit.real && sit.offense === homeAbbr ? " (offense)" : ""}</div></div>
      </div>
    `;
  }

  function renderField(sit) {
    const W = 640, H = 200, PAD = 20;
    const fieldW = W - PAD * 2;
    const fieldH = H - PAD * 2;
    const xFor = (yardline100) => PAD + (fieldW * (100 - yardline100)) / 100;

    const losX = xFor(sit.yardline_100);
    const firstDownYardline = Math.max(0, sit.yardline_100 - sit.ydstogo);
    const firstDownX = xFor(firstDownYardline);
    const redzoneX = xFor(20);

    const ticks = [];
    for (let v = 10; v <= 90; v += 10) {
      const num = v <= 50 ? v : 100 - v;
      const x = xFor(v);
      ticks.push(`<line class="field-line" x1="${x}" y1="${PAD}" x2="${x}" y2="${H - PAD}" />`);
      ticks.push(`<text class="field-yardnum" x="${x}" y="${PAD - 6}" text-anchor="middle">${num}</text>`);
    }

    const svg = `
      <svg class="field-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Field position: ${yardlineLabel(sit.yardline_100)}, ${ordinal(sit.down)} and ${sit.ydstogo}">
        <rect class="field-turf" x="${PAD}" y="${PAD}" width="${fieldW}" height="${fieldH}" />
        <rect class="field-redzone" x="${redzoneX}" y="${PAD}" width="${W - PAD - redzoneX}" height="${fieldH}" />
        ${ticks.join("")}
        <line class="field-line-major" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" />
        <line class="field-line-major" x1="${W - PAD}" y1="${PAD}" x2="${W - PAD}" y2="${H - PAD}" />
        <line class="field-firstdown" x1="${firstDownX}" y1="${PAD}" x2="${firstDownX}" y2="${H - PAD}" />
        <line class="field-los" x1="${losX}" y1="${PAD}" x2="${losX}" y2="${H - PAD}" />
        <ellipse class="field-ball" cx="${losX}" cy="${H / 2}" rx="6" ry="4" />
        <text class="field-yardnum" x="${PAD + 4}" y="${H - 6}" text-anchor="start">${sit.offense} own goal →</text>
        <text class="field-yardnum" x="${W - PAD - 4}" y="${H - 6}" text-anchor="end">← ${sit.defense} end zone</text>
      </svg>
    `;
    $("situation-field").innerHTML = svg;
  }

  function renderSpectrum(sit) {
    const passProb = NFLModel.predictPassProbability(sit);
    renderMeter($("situation-spectrum"), passProb);
  }

  function renderDriveNote(sit) {
    const bucket = fieldBucket(sit.yardline_100);
    const o = simTables.bucket_outcomes[bucket];
    if (!o) { $("situation-drive-note").textContent = ""; return; }
    $("situation-drive-note").innerHTML =
      `From this field position league-wide (2021–2025, n=${o.n_drives.toLocaleString()} drives): ` +
      `<strong>${Math.round(o.TD * 100)}% end in a TD</strong>, ${Math.round(o.FG * 100)}% a field goal, ` +
      `${Math.round((o.NO_SCORE) * 100)}% no score. ` +
      `<a href="#" data-view-link="simulate">Run a full-game simulation for this matchup &rarr;</a>`;
    const link = $("situation-drive-note").querySelector("[data-view-link]");
    if (link) link.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector('.tab-btn[data-view="simulate"]').click();
    });
  }

  // ---------------------------------------------------------------- why

  function whyFactors(sit) {
    const base = NFLModel.predictPassProbability(sit);
    const rows = [];

    const downAlt = NFLModel.predictPassProbability({ ...sit, down: 1 });
    rows.push({
      label: `${ordinal(sit.down)} down`,
      delta: base - downAlt,
      basis: "model sensitivity vs. 1st down, same everything else",
    });

    const distAlt = NFLModel.predictPassProbability({ ...sit, ydstogo: 10 });
    rows.push({
      label: `${sit.ydstogo} yards to go`,
      delta: base - distAlt,
      basis: "model sensitivity vs. 1st-and-10 distance",
    });

    const scoreAlt = NFLModel.predictPassProbability({ ...sit, score_differential: 0 });
    const scoreLabel = sit.score_differential === 0 ? "Tied" : sit.score_differential > 0 ? `Leading by ${sit.score_differential}` : `Trailing by ${Math.abs(sit.score_differential)}`;
    rows.push({
      label: scoreLabel,
      delta: base - scoreAlt,
      basis: "model sensitivity vs. a tied game",
    });

    const timeAlt = NFLModel.predictPassProbability({ ...sit, game_seconds_remaining: 1800, qtr: 3 });
    const twoMinute = [2, 4].includes(sit.qtr) && (sit.game_seconds_remaining % 900) <= 120;
    rows.push({
      label: twoMinute ? "Two-minute situation" : `${formatClock(sit.game_seconds_remaining).clock} left, Q${sit.qtr}`,
      delta: base - timeAlt,
      basis: "model sensitivity vs. mid-3rd-quarter, plenty of time",
    });

    const dBucket = distanceBucket(sit.ydstogo);
    const downKey = String(sit.down);
    const offSplit = teamSplits.offense[sit.offense];
    const defSplit = teamSplits.defense[sit.defense];
    const leagueSplit = teamSplits.league;
    if (offSplit && offSplit.by_down[downKey] && offSplit.by_down[downKey].n > 0) {
      const teamCell = offSplit.by_down[downKey];
      const leagueCell = leagueSplit.by_down[downKey];
      rows.push({
        label: `${sit.offense}'s tendency on ${ordinal(sit.down)} down`,
        delta: teamCell.pass_rate - leagueCell.pass_rate,
        basis: `real 2023–2025 split: ${sit.offense} passes ${Math.round(teamCell.pass_rate * 100)}% vs league ${Math.round(leagueCell.pass_rate * 100)}%, n=${teamCell.n}`,
      });
    }
    if (defSplit && defSplit.by_down[downKey] && defSplit.by_down[downKey].n > 0) {
      const teamCell = defSplit.by_down[downKey];
      const leagueCell = leagueSplit.by_down[downKey];
      rows.push({
        label: `${sit.defense}'s defensive profile`,
        delta: teamCell.pass_rate - leagueCell.pass_rate,
        basis: `opponents pass ${Math.round(teamCell.pass_rate * 100)}% vs this defense on ${ordinal(sit.down)} down, league ${Math.round(leagueCell.pass_rate * 100)}%, n=${teamCell.n}`,
      });
    }

    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return { base, rows, dBucket };
  }

  function renderWhy(sit) {
    const { base, rows } = whyFactors(sit);
    const maxAbs = 0.25;
    const rowsHtml = rows.map((r) => {
      const pct = Math.min(100, (Math.abs(r.delta) / maxAbs) * 100);
      const dir = r.delta >= 0 ? "up" : "down";
      const rounded = Math.abs(Math.round(r.delta * 100));
      const sign = rounded === 0 ? "" : r.delta >= 0 ? "+" : "−";
      return `
        <div class="why-row">
          <div>
            <span class="why-label">${escapeHtml(r.label)}</span>
            <span class="why-basis">${escapeHtml(r.basis)}</span>
          </div>
          <div class="why-bar-track" style="width:90px">
            <div class="why-bar-fill ${dir === "down" ? "neg" : ""}" style="width:${pct}%; ${dir === "down" ? `right:50%` : `left:50%`}"></div>
          </div>
          <span class="why-delta ${dir}">${sign}${rounded} pt</span>
        </div>
      `;
    }).join("");
    $("situation-why").innerHTML = `
      <p class="split-note">Model says <strong>${Math.round(base * 100)}% pass</strong>. Each row shows how much one factor moves that number, holding everything else at its current value — or, for the last two rows, how this specific team's real play-calling compares to the league.</p>
      ${rowsHtml}
    `;
  }

  // -------------------------------------------------------------- what-if

  function wireWhatIf() {
    $("whatif-toggle").addEventListener("click", () => {
      const panel = $("whatif-panel");
      const showing = panel.style.display !== "none";
      panel.style.display = showing ? "none" : "";
      if (!showing) buildWhatIfControls();
    });
  }

  function buildWhatIfControls() {
    const sit = currentSituation();
    if (!sit) return;
    $("whatif-controls").innerHTML = `
      <div class="field"><label>Down</label>
        <select id="wi-down">
          ${[1, 2, 3, 4].map((d) => `<option value="${d}" ${d === sit.down ? "selected" : ""}>${ordinal(d)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Distance: <span id="wi-distance-val">${sit.ydstogo}</span></label>
        <input type="range" id="wi-distance" min="1" max="25" value="${sit.ydstogo}" />
      </div>
      <div class="field"><label>Field position: <span id="wi-yardline-val">${yardlineLabel(sit.yardline_100)}</span></label>
        <input type="range" id="wi-yardline" min="1" max="99" value="${sit.yardline_100}" />
      </div>
      <div class="field"><label>Clock: <span id="wi-clock-val">${formatClock(sit.game_seconds_remaining).clock}</span></label>
        <input type="range" id="wi-clock" min="0" max="3600" value="${sit.game_seconds_remaining}" />
      </div>
      <div class="field"><label>Score differential: <span id="wi-score-val">${sit.score_differential}</span></label>
        <input type="range" id="wi-score" min="-28" max="28" value="${sit.score_differential}" />
      </div>
    `;
    ["wi-down", "wi-distance", "wi-yardline", "wi-clock", "wi-score"].forEach((id) => {
      $(id).addEventListener("input", renderWhatIf);
    });
    renderWhatIf();
  }

  function renderWhatIf() {
    const sit = currentSituation();
    if (!sit) return;
    $("wi-distance-val").textContent = $("wi-distance").value;
    $("wi-yardline-val").textContent = yardlineLabel(Number($("wi-yardline").value));
    $("wi-clock-val").textContent = formatClock(Number($("wi-clock").value)).clock;
    $("wi-score-val").textContent = $("wi-score").value;

    const scenario = {
      ...sit,
      down: Number($("wi-down").value),
      ydstogo: Number($("wi-distance").value),
      yardline_100: Number($("wi-yardline").value),
      game_seconds_remaining: Number($("wi-clock").value),
      qtr: Math.max(1, Math.min(4, 4 - Math.floor(Number($("wi-clock").value) / 900))),
      score_differential: Number($("wi-score").value),
    };

    const probA = NFLModel.predictPassProbability(sit);
    const probB = NFLModel.predictPassProbability(scenario);
    const delta = probB - probA;
    const dir = delta >= 0 ? "up" : "down";
    const rounded = Math.abs(Math.round(delta * 100));
    const sign = rounded === 0 ? "" : delta >= 0 ? "+" : "−";

    $("whatif-result").innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="value">${Math.round(probA * 100)}%</div><div class="label">current situation, P(pass)</div></div>
        <div class="stat"><div class="value">${Math.round(probB * 100)}%</div><div class="label">what-if, P(pass)</div></div>
        <div class="stat"><div class="value why-delta ${dir}" style="font-family:var(--font-display);font-size:34px">${sign}${rounded} pt</div><div class="label">change</div></div>
      </div>
    `;
  }

  // ---------------------------------------------------------- comparables

  function wireComparables() {
    $("comparables-load").addEventListener("click", async () => {
      $("comparables-load").disabled = true;
      $("comparables-load").textContent = "Loading 2023–2025 plays…";
      await ensureAllPlaysLoaded();
      $("comparables-load").textContent = "Find comparable plays";
      $("comparables-load").disabled = false;
      renderComparables();
    });
  }

  async function ensureAllPlaysLoaded() {
    if (allPlaysCache) return allPlaysCache;
    const seasons = [2023, 2024, 2025];
    const perSeason = await Promise.all(seasons.map((s) => NFLData.loadSeasonGames(s)));
    const flat = [];
    perSeason.forEach((games, i) => {
      for (const g of games) {
        for (let idx = 0; idx < g.plays.length; idx++) {
          flat.push({ ...g.plays[idx], game_id: g.game_id, season: seasons[i], week: g.week, playIndex: idx });
        }
      }
    });
    allPlaysCache = flat;
    return flat;
  }

  function renderComparables() {
    const sit = currentSituation();
    if (!sit || !allPlaysCache) return;

    const scored = allPlaysCache
      .filter((p) => p.down === sit.down)
      .map((p) => {
        const dDist = Math.abs(p.ydstogo - sit.ydstogo);
        const dField = Math.abs(p.yardline_100 - sit.yardline_100);
        const dScore = Math.abs(p.score_differential - sit.score_differential);
        const dTime = Math.abs(p.game_seconds_remaining - sit.game_seconds_remaining) / 3600;
        const dist = dDist * 1.2 + dField * 0.6 + dScore * 0.5 + dTime * 8;
        return { p, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 25);

    if (!scored.length) {
      $("comparables-results").innerHTML = `<p class="empty-note">No comparable plays found.</p>`;
      return;
    }

    $("comparables-results").innerHTML =
      `<p class="split-note">${scored.length} closest matches by down, distance, field position, score, and time, out of ${allPlaysCache.length.toLocaleString()} plays searched.</p>` +
      scored.map(({ p }) => `
        <div class="comparable-row" data-season="${p.season}" data-game="${p.game_id}" data-index="${p.playIndex}">
          <span class="cr-meta">${p.season} wk${p.week}</span>
          <span class="cr-meta">${p.posteam} vs ${p.defteam}</span>
          <span class="cr-meta">${ordinal(p.down)} &amp; ${p.ydstogo}</span>
          <span class="${p.actual === "pass" ? "meter-seg pass" : "meter-seg run"}" style="padding:1px 6px;border-radius:3px;display:inline-block;text-align:center;font-size:11px">${p.actual.toUpperCase()}${p.yards_gained != null ? " " + (p.yards_gained >= 0 ? "+" : "") + p.yards_gained : ""}</span>
          <span class="cr-desc">${escapeHtml(p.desc || "")}</span>
        </div>
      `).join("");

    $("comparables-results").querySelectorAll(".comparable-row").forEach((row) => {
      row.addEventListener("click", async () => {
        document.querySelector('#situation-mode-toggle button[data-mode="scrub"]').click();
        const season = Number(row.dataset.season);
        $("scrub-season").value = String(season);
        const gamesIndex = await NFLData.loadGamesIndex();
        populateScrubGames(gamesIndex);
        $("scrub-game").value = row.dataset.game;
        await loadScrubGame(row.dataset.game, Number(row.dataset.index));
      });
    });
  }

  return { init };
})();
