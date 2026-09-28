// Tab switching + shared render helpers + boot sequence.

// live.js interpolates fields from ESPN's public API into innerHTML; escape
// anything that isn't a value we generated ourselves.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderMeter(container, passProb) {
  const passPct = Math.round(passProb * 100);
  const runPct = 100 - passPct;
  container.innerHTML = `
    <div class="meter">
      <div class="meter-seg run" style="width:${runPct}%">${runPct >= 12 ? "RUN " + runPct + "%" : ""}</div>
      <div class="meter-seg pass" style="width:${passPct}%">${passPct >= 12 ? "PASS " + passPct + "%" : ""}</div>
    </div>
    <div class="meter-legend">
      <span class="legend-chip"><span class="swatch run"></span>Run</span>
      <span class="legend-chip"><span class="swatch pass"></span>Pass</span>
    </div>
  `;
}

function formatClock(gameSecondsRemaining) {
  const q = Math.max(1, Math.min(4, 4 - Math.floor(gameSecondsRemaining / 900)));
  const secIntoQuarter = gameSecondsRemaining % 900;
  const mm = Math.floor(secIntoQuarter / 60);
  const ss = Math.floor(secIntoQuarter % 60);
  return { qtr: q, clock: `${mm}:${String(ss).padStart(2, "0")}` };
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function downDistanceText(down, ydstogo, yardline100) {
  const side = yardline100 <= 50 ? `OPP ${yardline100}` : `OWN ${100 - yardline100}`;
  return `${ordinal(down)} & ${ydstogo} at ${side}`;
}

// Renders one situational row: a run/pass split bar (with a marker for the
// league baseline at that same situation), sample size, and EPA/play.
function renderSplitRow(label, cell, leagueCell) {
  if (!cell || cell.n === 0) {
    return `<div class="split-row"><span class="split-label">${escapeHtml(label)}</span><span class="split-note" style="margin:0">no plays</span><span></span><span></span></div>`;
  }
  const passPct = Math.round(cell.pass_rate * 100);
  const leaguePct = leagueCell ? Math.round(leagueCell.pass_rate * 100) : null;
  const epa = cell.epa_per_play;
  const epaClass = epa == null ? "" : epa >= 0 ? "positive" : "negative";
  const epaText = epa == null ? "—" : (epa >= 0 ? "+" : "") + epa.toFixed(2);
  return `
    <div class="split-row">
      <span class="split-label">${escapeHtml(label)}${cell.low_sample ? '<span class="low-sample-tag">low n</span>' : ""}</span>
      <div class="split-bar-track">
        <div class="split-bar-fill" style="width:${passPct}%"></div>
        ${leaguePct !== null ? `<div class="split-bar-marker" style="left:${leaguePct}%" title="League: ${leaguePct}% pass"></div>` : ""}
      </div>
      <span class="split-n">n=${cell.n}</span>
      <span class="split-epa ${epaClass}">${epaText} epa</span>
    </div>
  `;
}

function teamLogoImg(abbr, size = 34) {
  const t = NFLData.team(abbr);
  const src = t ? escapeHtml(t.logo) : "";
  const safeAbbr = escapeHtml(abbr);
  return `<img src="${src}" alt="${safeAbbr}" width="${size}" height="${size}" style="object-fit:contain" onerror="this.style.visibility='hidden'" />`;
}

async function boot() {
  await Promise.all([NFLModel.load(), NFLData.loadTeams()]);

  const tabs = document.querySelectorAll(".tab-btn");
  const views = document.querySelectorAll(".view");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      views.forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    });
  });

  Situation.init();
  Live.init();
  Simulate.init();
  Teams.init();
  ModelEval.init();
}

boot();
