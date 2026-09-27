// "Live" tab: polls ESPN's public, key-less scoreboard API directly from
// the browser (no backend of ours involved) and predicts the offense's
// next call from the game's current situation.

const Live = (() => {
  const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";
  const REFRESH_MS = 15000;

  let events = [];
  let selectedId = null;
  let refreshTimer = null;

  const gameSelect = () => document.getElementById("live-game");
  const personnelSelect = () => document.getElementById("live-personnel");
  const scoreboardEl = () => document.getElementById("live-scoreboard");
  const logEl = () => document.getElementById("live-log");
  const meterWrap = () => document.getElementById("live-meter-wrap");

  const COMMON_PERSONNEL = ["11", "12", "21", "22", "10", "13", "20", "23", "01", "02"];

  function init() {
    const cats = NFLModel.personnelCategories().filter((c) => c !== "UNK");
    const ordered = [...COMMON_PERSONNEL.filter((c) => cats.includes(c)), ...cats.filter((c) => !COMMON_PERSONNEL.includes(c))];
    personnelSelect().innerHTML = ordered
      .map((c) => `<option value="${c}" ${c === "11" ? "selected" : ""}>${c} personnel</option>`)
      .join("");

    gameSelect().addEventListener("change", () => {
      selectedId = gameSelect().value;
      renderSelected();
    });
    personnelSelect().addEventListener("change", renderSelected);
    document.getElementById("live-refresh").addEventListener("click", refresh);

    refresh();
    refreshTimer = setInterval(refresh, REFRESH_MS);
  }

  async function refresh() {
    try {
      const data = await fetch(SCOREBOARD_URL).then((r) => r.json());
      events = data.events || [];
      populateSelect();
      await renderSelected();
    } catch (err) {
      logEl().innerHTML = `<p class="empty-note">Couldn't reach ESPN's live feed right now (${escapeHtml(String(err.message || err))}). Will retry.</p>`;
    }
  }

  function populateSelect() {
    const prev = selectedId;
    gameSelect().innerHTML = events
      .map((e) => {
        const c = e.competitions[0];
        const home = c.competitors.find((t) => t.homeAway === "home");
        const away = c.competitors.find((t) => t.homeAway === "away");
        const status = c.status.type.shortDetail;
        return `<option value="${e.id}">${away.team.abbreviation} @ ${home.team.abbreviation} — ${status}</option>`;
      })
      .join("");
    if (!events.length) {
      gameSelect().innerHTML = `<option>No games found</option>`;
      selectedId = null;
      return;
    }
    selectedId = prev && events.some((e) => e.id === prev) ? prev : (
      events.find((e) => e.competitions[0].status.type.state === "in") || events[0]
    ).id;
    gameSelect().value = selectedId;
  }

  function nflverseAbbr(espnAbbr) {
    return NFLData.espnToNflverse(espnAbbr);
  }

  async function renderSelected() {
    if (!selectedId) {
      scoreboardEl().hidden = true;
      logEl().innerHTML = `<p class="empty-note">No games today.</p>`;
      meterWrap().innerHTML = `<p class="empty-note">&mdash;</p>`;
      return;
    }
    const event = events.find((e) => e.id === selectedId);
    if (!event) return;
    const comp = event.competitions[0];
    const home = comp.competitors.find((t) => t.homeAway === "home");
    const away = comp.competitors.find((t) => t.homeAway === "away");
    const state = comp.status.type.state; // "pre" | "in" | "post"

    scoreboardEl().hidden = false;
    const homeAbbr = nflverseAbbr(home.team.abbreviation);
    const awayAbbr = nflverseAbbr(away.team.abbreviation);
    const situationText = state === "pre"
      ? new Date(event.date).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
      : state === "post"
        ? "FINAL"
        : (comp.situation ? comp.situation.shortDownDistanceText : comp.status.type.shortDetail);
    const clockText = state === "in" ? `Q${comp.status.period}  ${comp.status.displayClock}` : (state === "in" ? "" : escapeHtml(comp.status.type.detail));

    scoreboardEl().innerHTML = `
      <div class="sb-team away">${teamLogoImg(awayAbbr)}<div><div class="sb-score">${escapeHtml(away.score)}</div><div class="sb-abbr">${escapeHtml(awayAbbr)}</div></div></div>
      <div class="sb-mid">
        <div class="sb-situation">${state === "in" ? '<span class="live-dot"></span>' : ""}${escapeHtml(situationText)}</div>
        <div class="sb-clock">${clockText}</div>
      </div>
      <div class="sb-team home">${teamLogoImg(homeAbbr)}<div><div class="sb-score">${escapeHtml(home.score)}</div><div class="sb-abbr">${escapeHtml(homeAbbr)}</div></div></div>
    `;

    if (state === "in" && comp.situation && comp.situation.down) {
      const possessionEspnId = comp.situation.possession;
      const possessingIsHome = home.team.id === possessionEspnId;
      const posScore = Number(possessingIsHome ? home.score : away.score);
      const defScore = Number(possessingIsHome ? away.score : home.score);
      const period = comp.status.period || 1;
      const clockInPeriod = comp.status.clock || 0;
      const gameSecondsRemaining = Math.max(0, (4 - Math.min(period, 4)) * 900 + (period <= 4 ? clockInPeriod : 0));

      const situation = {
        down: comp.situation.down,
        ydstogo: comp.situation.distance,
        yardline_100: comp.situation.yardLine,
        score_differential: posScore - defScore,
        game_seconds_remaining: gameSecondsRemaining,
        qtr: Math.min(period, 4),
        personnel_group: personnelSelect().value || "11",
      };
      const passProb = NFLModel.predictPassProbability(situation);
      renderMeter(meterWrap(), passProb);
    } else {
      meterWrap().innerHTML = `<p class="empty-note">${state === "pre" ? "Prediction available once the game kicks off." : "Game has ended."}</p>`;
    }

    if (state !== "pre") {
      await renderRecentPlays(event.id);
    } else {
      logEl().innerHTML = `<p class="empty-note">No plays yet.</p>`;
    }
  }

  async function renderRecentPlays(eventId) {
    try {
      const summary = await fetch(SUMMARY_URL + eventId).then((r) => r.json());
      const plays = (summary.drives && summary.drives.current && summary.drives.current.plays) || [];
      const snaps = plays.filter((p) => p.start && p.start.down).slice(-12).reverse();
      if (!snaps.length) {
        logEl().innerHTML = `<p class="empty-note">No play detail available yet.</p>`;
        return;
      }
      logEl().innerHTML = snaps
        .map((p) => `
          <div class="play-row" style="grid-template-columns: 90px 1fr;">
            <span class="down-dist">${escapeHtml(p.start.shortDownDistanceText || "")}</span>
            <span>${escapeHtml(p.text || "")}</span>
          </div>
        `)
        .join("");
    } catch (err) {
      logEl().innerHTML = `<p class="empty-note">Play log unavailable right now.</p>`;
    }
  }

  return { init };
})();
