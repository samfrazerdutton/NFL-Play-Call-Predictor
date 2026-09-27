// "Replay" tab: step through a real historical game, comparing the model's
// pre-snap prediction to what the offense actually did.

const Replay = (() => {
  let seasonGamesCache = {};
  let gamesIndex = [];
  let currentGame = null;
  let idx = 0; // next play to reveal
  let correct = 0;
  let revealed = 0;
  let playTimer = null;

  const seasonSelect = () => document.getElementById("replay-season");
  const gameSelect = () => document.getElementById("replay-game");
  const scoreboardEl = () => document.getElementById("replay-scoreboard");
  const logEl = () => document.getElementById("replay-log");
  const meterWrap = () => document.getElementById("replay-meter-wrap");
  const accuracyEl = () => document.getElementById("replay-accuracy");
  const playCountEl = () => document.getElementById("replay-play-count");
  const prevBtn = () => document.getElementById("replay-prev");
  const playBtn = () => document.getElementById("replay-play");
  const nextBtn = () => document.getElementById("replay-next");

  async function init() {
    gamesIndex = await NFLData.loadGamesIndex();
    const seasons = [...new Set(gamesIndex.map((g) => g.season))].sort((a, b) => b - a);
    seasonSelect().innerHTML = seasons.map((s) => `<option value="${s}">${s}</option>`).join("");
    seasonSelect().addEventListener("change", onSeasonChange);
    gameSelect().addEventListener("change", onGameChange);
    prevBtn().addEventListener("click", () => step(-1));
    nextBtn().addEventListener("click", () => step(1));
    playBtn().addEventListener("click", toggleAutoplay);
    onSeasonChange();
  }

  function onSeasonChange() {
    const season = Number(seasonSelect().value);
    const games = gamesIndex
      .filter((g) => g.season === season)
      .sort((a, b) => a.week - b.week);
    gameSelect().innerHTML = games
      .map((g) => {
        const label = `Wk ${g.week}: ${g.away_team} ${g.away_score ?? ""} @ ${g.home_team} ${g.home_score ?? ""}`;
        return `<option value="${g.game_id}">${label}</option>`;
      })
      .join("");
    onGameChange();
  }

  async function onGameChange() {
    stopAutoplay();
    const season = Number(seasonSelect().value);
    const gameId = gameSelect().value;
    if (!seasonGamesCache[season]) {
      seasonGamesCache[season] = await NFLData.loadSeasonGames(season);
    }
    currentGame = seasonGamesCache[season].find((g) => g.game_id === gameId);
    idx = 0;
    correct = 0;
    revealed = 0;
    logEl().innerHTML = "";
    accuracyEl().textContent = "—";
    playCountEl().textContent = "0";
    scoreboardEl().hidden = false;
    renderScoreboardShell();
    updateNav();
    if (currentGame && currentGame.plays.length) {
      renderUpcomingMeter();
    }
  }

  function renderScoreboardShell() {
    if (!currentGame) return;
    const away = currentGame.away_team;
    const home = currentGame.home_team;
    scoreboardEl().innerHTML = `
      <div class="sb-team away">${teamLogoImg(away)}<div><div class="sb-score" id="rp-away-score">0</div><div class="sb-abbr">${away}</div></div></div>
      <div class="sb-mid">
        <div class="sb-situation" id="rp-situation">&mdash;</div>
        <div class="sb-clock" id="rp-clock">&mdash;</div>
      </div>
      <div class="sb-team home">${teamLogoImg(home)}<div><div class="sb-score" id="rp-home-score">0</div><div class="sb-abbr">${home}</div></div></div>
    `;
  }

  function renderUpcomingMeter() {
    const play = currentGame.plays[idx];
    const passProb = NFLModel.predictPassProbability(play);
    renderMeter(meterWrap(), passProb);
  }

  function updateScoreboard(play) {
    document.getElementById("rp-away-score").textContent = play.away_score;
    document.getElementById("rp-home-score").textContent = play.home_score;
    document.getElementById("rp-situation").textContent = `${ordinal(play.down)} & ${play.ydstogo}`;
    const { qtr, clock } = formatClock(play.game_seconds_remaining);
    document.getElementById("rp-clock").textContent = `Q${qtr}  ${clock}`;
  }

  function step(dir) {
    if (!currentGame) return;
    if (dir > 0) revealNext();
    else undoLast();
    updateNav();
  }

  function revealNext() {
    if (idx >= currentGame.plays.length) return;
    const play = currentGame.plays[idx];
    const passProb = NFLModel.predictPassProbability(play);
    const predicted = passProb >= 0.5 ? "pass" : "run";
    const isCorrect = predicted === play.actual;
    if (isCorrect) correct += 1;
    revealed += 1;

    updateScoreboard(play);

    const row = document.createElement("div");
    row.className = "play-row";
    row.innerHTML = `
      <span class="down-dist">${ordinal(play.down)} & ${play.ydstogo}</span>
      <span>${play.posteam} — actual: <strong>${play.actual.toUpperCase()}</strong></span>
      <span class="predicted ${predicted}">${predicted.toUpperCase()} ${Math.round((predicted === "pass" ? passProb : 1 - passProb) * 100)}%</span>
      <span class="hit ${isCorrect ? "correct" : "wrong"}">${isCorrect ? "✓" : "✗"}</span>
    `;
    logEl().appendChild(row);

    idx += 1;
    accuracyEl().textContent = `${Math.round((correct / revealed) * 100)}%`;
    playCountEl().textContent = String(revealed);

    if (idx < currentGame.plays.length) {
      renderUpcomingMeter();
    } else {
      meterWrap().innerHTML = '<p class="empty-note">End of game.</p>';
      stopAutoplay();
    }
  }

  function undoLast() {
    if (revealed === 0) return;
    idx -= 1;
    const lastRow = logEl().lastElementChild;
    if (lastRow) {
      const wasCorrect = lastRow.querySelector(".hit").classList.contains("correct");
      if (wasCorrect) correct -= 1;
      revealed -= 1;
      lastRow.remove();
    }
    if (revealed > 0) {
      updateScoreboard(currentGame.plays[idx - 1]);
      accuracyEl().textContent = `${Math.round((correct / revealed) * 100)}%`;
    } else {
      accuracyEl().textContent = "—";
    }
    playCountEl().textContent = String(revealed);
    renderUpcomingMeter();
  }

  function updateNav() {
    const atStart = !currentGame || revealed === 0;
    const atEnd = !currentGame || idx >= currentGame.plays.length;
    prevBtn().disabled = atStart;
    nextBtn().disabled = atEnd;
    playBtn().disabled = atEnd;
  }

  function toggleAutoplay() {
    if (playTimer) {
      stopAutoplay();
      return;
    }
    playBtn().textContent = "Pause";
    playTimer = setInterval(() => {
      if (!currentGame || idx >= currentGame.plays.length) {
        stopAutoplay();
        return;
      }
      step(1);
    }, 1100);
  }

  function stopAutoplay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    playBtn().textContent = "Play";
  }

  return { init };
})();
