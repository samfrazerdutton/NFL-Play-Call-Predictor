// "Simulate" tab: client-side Monte Carlo game simulator built from real
// historical drive outcomes (2021-2025), resampled per-drive and scaled by
// each team's own offensive/defensive drive-scoring rates.

const Simulate = (() => {
  const N_SIMS = 2000;
  const CHUNK = 200;
  const REGULATION_SECONDS = 3600;
  const MAX_OT_POSSESSIONS = 6;

  let simTables = null;
  let teamAbbrs = [];

  const awaySelect = () => document.getElementById("sim-away-team");
  const homeSelect = () => document.getElementById("sim-home-team");
  const awayLogo = () => document.getElementById("sim-away-logo");
  const homeLogo = () => document.getElementById("sim-home-logo");
  const runBtn = () => document.getElementById("sim-run");
  const progressEl = () => document.getElementById("sim-progress");
  const resultsEl = () => document.getElementById("sim-results");

  async function init() {
    simTables = await NFLData.loadSimTables();
    teamAbbrs = Object.keys(simTables.team_indices).sort();
    const options = teamAbbrs
      .map((abbr) => {
        const t = NFLData.team(abbr);
        return `<option value="${abbr}">${t ? t.name : abbr}</option>`;
      })
      .join("");
    awaySelect().innerHTML = options;
    homeSelect().innerHTML = options;
    awaySelect().value = teamAbbrs.includes("BUF") ? "BUF" : teamAbbrs[0];
    homeSelect().value = teamAbbrs.includes("KC") ? "KC" : teamAbbrs[1];

    awaySelect().addEventListener("change", updateLogos);
    homeSelect().addEventListener("change", updateLogos);
    runBtn().addEventListener("click", runSimulations);
    updateLogos();
  }

  function updateLogos() {
    const away = NFLData.team(awaySelect().value);
    const home = NFLData.team(homeSelect().value);
    awayLogo().src = away ? away.logo : "";
    homeLogo().src = home ? home.logo : "";
  }

  function weightedPick(dist) {
    const r = Math.random();
    let cumulative = 0;
    for (const [key, p] of Object.entries(dist)) {
      cumulative += p;
      if (r < cumulative) return key;
    }
    return Object.keys(dist)[0];
  }

  function simulateOneGame(awayAbbr, homeAbbr) {
    const idx = simTables.team_indices;
    const awayIdx = idx[awayAbbr] || { offense_index: 1, defense_allow_index: 1 };
    const homeIdx = idx[homeAbbr] || { offense_index: 1, defense_allow_index: 1 };

    let score = { [awayAbbr]: 0, [homeAbbr]: 0 };
    let possession = Math.random() < 0.5 ? awayAbbr : homeAbbr;
    let clock = REGULATION_SECONDS;

    function runDrive(offense, defense) {
      const offIdx = offense === awayAbbr ? awayIdx : homeIdx;
      const defIdx = defense === awayAbbr ? awayIdx : homeIdx;
      const bucket = weightedPick(simTables.start_distribution);
      const o = simTables.bucket_outcomes[bucket];

      const pSafety = o.SAFETY;
      const pDefTd = o.DEF_TD;
      const remaining = Math.max(1e-9, o.TD + o.FG + o.NO_SCORE);
      const baseScoreShare = (o.TD + o.FG) / remaining;
      const baseOdds = baseScoreShare / Math.max(1e-9, 1 - baseScoreShare);
      const adjOdds = baseOdds * offIdx.offense_index * defIdx.defense_allow_index;
      const adjScoreShare = adjOdds / (1 + adjOdds);
      const tdShare = o.TD / Math.max(1e-9, o.TD + o.FG);

      const pTd = remaining * adjScoreShare * tdShare;
      const pFg = remaining * adjScoreShare * (1 - tdShare);
      const pNo = remaining * (1 - adjScoreShare);

      const outcome = weightedPick({ SAFETY: pSafety, DEF_TD: pDefTd, TD: pTd, FG: pFg, NO_SCORE: pNo });

      if (outcome === "TD") score[offense] += 7;
      else if (outcome === "FG") score[offense] += 3;
      else if (outcome === "SAFETY") score[defense] += 2;
      else if (outcome === "DEF_TD") score[defense] += 7;

      const jitter = 0.6 + Math.random() * 0.8;
      const duration = Math.min(500, Math.max(15, o.median_duration_s * jitter));
      clock -= duration;
    }

    while (clock > 0) {
      const defense = possession === awayAbbr ? homeAbbr : awayAbbr;
      runDrive(possession, defense);
      possession = possession === awayAbbr ? homeAbbr : awayAbbr;
    }

    if (score[awayAbbr] === score[homeAbbr]) {
      let otPossessions = 0;
      let otTurn = Math.random() < 0.5 ? awayAbbr : homeAbbr;
      const startScore = score[awayAbbr];
      while (score[awayAbbr] === score[homeAbbr] && otPossessions < MAX_OT_POSSESSIONS) {
        const defense = otTurn === awayAbbr ? homeAbbr : awayAbbr;
        runDrive(otTurn, defense);
        otPossessions += 1;
        otTurn = otTurn === awayAbbr ? homeAbbr : awayAbbr;
      }
    }

    return { away: score[awayAbbr], home: score[homeAbbr] };
  }

  function runSimulations() {
    const awayAbbr = awaySelect().value;
    const homeAbbr = homeSelect().value;
    runBtn().disabled = true;
    resultsEl().hidden = true;

    const results = [];
    let done = 0;

    function chunkStep() {
      const end = Math.min(done + CHUNK, N_SIMS);
      for (let i = done; i < end; i++) {
        results.push(simulateOneGame(awayAbbr, homeAbbr));
      }
      done = end;
      progressEl().textContent = `${done.toLocaleString()} / ${N_SIMS.toLocaleString()} games simulated…`;
      if (done < N_SIMS) {
        setTimeout(chunkStep, 0);
      } else {
        progressEl().textContent = `${N_SIMS.toLocaleString()} games simulated.`;
        runBtn().disabled = false;
        renderResults(awayAbbr, homeAbbr, results);
      }
    }
    chunkStep();
  }

  function renderResults(awayAbbr, homeAbbr, results) {
    let awayWins = 0, homeWins = 0, ties = 0;
    let awaySum = 0, homeSum = 0;
    const margins = [];
    for (const r of results) {
      if (r.away > r.home) awayWins += 1;
      else if (r.home > r.away) homeWins += 1;
      else ties += 1;
      awaySum += r.away;
      homeSum += r.home;
      margins.push(r.home - r.away);
    }
    const n = results.length;
    const awayPct = Math.round((awayWins / n) * 100);
    const homePct = Math.round((homeWins / n) * 100);
    const tiePct = Math.max(0, 100 - awayPct - homePct);

    const awayTeam = NFLData.team(awayAbbr);
    const homeTeam = NFLData.team(homeAbbr);
    const awayColor = awayTeam ? awayTeam.color : "#3987e5";
    const homeColor = homeTeam ? homeTeam.color : "#d95926";

    resultsEl().hidden = false;
    document.getElementById("sim-winbar").innerHTML = `
      <div class="win-seg" style="width:${awayPct}%; background:${awayColor}; color:${NFLData.readableTextColor(awayColor)}">${awayPct}%</div>
      <div class="win-seg" style="width:${homePct}%; background:${homeColor}; color:${NFLData.readableTextColor(homeColor)}; justify-content:flex-end">${homePct}%</div>
    `;
    document.getElementById("sim-away-label").textContent = `${awayAbbr} win`;
    document.getElementById("sim-tie-label").textContent = tiePct > 0 ? `${tiePct}% tie` : `avg ${(awaySum / n).toFixed(1)} – ${(homeSum / n).toFixed(1)}`;
    document.getElementById("sim-home-label").textContent = `${homeAbbr} win`;

    renderHistogram(margins, awayColor, homeColor);

    const idx = simTables.team_indices;
    const rows = [awayAbbr, homeAbbr]
      .map((abbr) => {
        const t = NFLData.team(abbr);
        const stat = idx[abbr] || { offense_index: 1, defense_allow_index: 1 };
        return `<tr><td>${t ? t.name : abbr}</td><td>${stat.offense_index.toFixed(2)}×</td><td>${stat.defense_allow_index.toFixed(2)}×</td></tr>`;
      })
      .join("");
    document.querySelector("#sim-stats-table tbody").innerHTML = rows;
  }

  function renderHistogram(margins, awayColor, homeColor) {
    const binSize = 7;
    const bins = {};
    for (const m of margins) {
      const b = Math.round(m / binSize) * binSize;
      bins[b] = (bins[b] || 0) + 1;
    }
    const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
    const maxCount = Math.max(...keys.map((k) => bins[k]));
    const container = document.getElementById("sim-hist");
    container.innerHTML = keys
      .map((k) => {
        const h = Math.max(2, Math.round((bins[k] / maxCount) * 90));
        const color = k >= 0 ? homeColor : awayColor;
        const label = k > 0 ? `+${k}` : `${k}`;
        return `<div class="bar-pair" title="Home margin ${label}: ${bins[k]} of ${margins.length} sims"><div class="bar" style="height:${h}px; background:${color}"></div></div>`;
      })
      .join("");
  }

  return { init };
})();
