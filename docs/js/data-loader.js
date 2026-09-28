// Shared data fetching + team lookups used across all three tabs.

const NFLData = (() => {
  const cache = {};

  // ESPN's live API spells two teams differently than nflverse's historical
  // data (LAR vs LA, WSH vs WAS). Route through nflverse's abbreviation
  // everywhere internally so team lookups/colors/model indices stay unified.
  const ESPN_TO_NFLVERSE = { LAR: "LA", WSH: "WAS" };

  function espnToNflverse(abbr) {
    return ESPN_TO_NFLVERSE[abbr] || abbr;
  }

  async function fetchJSON(path) {
    if (cache[path]) return cache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    const json = await res.json();
    cache[path] = json;
    return json;
  }

  let teamsById = null;

  async function loadTeams() {
    if (teamsById) return teamsById;
    const list = await fetchJSON("data/teams.json");
    teamsById = {};
    for (const t of list) teamsById[t.abbr] = t;
    return teamsById;
  }

  function team(abbr) {
    if (!teamsById) return null;
    return teamsById[abbr] || null;
  }

  async function loadGamesIndex() {
    return fetchJSON("data/games_index.json");
  }

  async function loadSeasonGames(season) {
    return fetchJSON(`data/games/${season}.json`);
  }

  async function loadSimTables() {
    return fetchJSON("data/sim_tables.json");
  }

  async function loadTeamSplits() {
    return fetchJSON("data/team_splits.json");
  }

  async function loadModelEval() {
    return fetchJSON("data/model_eval.json");
  }

  async function loadTeamPredictability() {
    return fetchJSON("data/team_predictability.json");
  }

  const REPLAY_SEASONS = [2023, 2024, 2025];
  let allPlaysCache = null;

  // Flattens every replay-era game's plays into one array, tagged with
  // game_id/season/week/playIndex. Loaded on demand (~35 MB) and cached in
  // memory so multiple features (comparables search, stat calculator) can
  // share one fetch instead of each loading the same three season files.
  async function loadAllPlays() {
    if (allPlaysCache) return allPlaysCache;
    const perSeason = await Promise.all(REPLAY_SEASONS.map((s) => loadSeasonGames(s)));
    const flat = [];
    perSeason.forEach((games, i) => {
      for (const g of games) {
        for (let idx = 0; idx < g.plays.length; idx++) {
          flat.push({ ...g.plays[idx], game_id: g.game_id, season: REPLAY_SEASONS[i], week: g.week, playIndex: idx });
        }
      }
    });
    allPlaysCache = flat;
    return flat;
  }

  // Relative luminance -> pick black or white text for legibility on a
  // team-color background, so identity is never carried by color alone.
  function readableTextColor(hex) {
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16) / 255;
    const g = parseInt(c.substring(2, 4), 16) / 255;
    const b = parseInt(c.substring(4, 6), 16) / 255;
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.4 ? "#12151a" : "#f5f3ec";
  }

  return {
    espnToNflverse,
    fetchJSON,
    loadTeams,
    team,
    loadGamesIndex,
    loadSeasonGames,
    loadSimTables,
    loadTeamSplits,
    loadModelEval,
    loadTeamPredictability,
    loadAllPlays,
    readableTextColor,
  };
})();
