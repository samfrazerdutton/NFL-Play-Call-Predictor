"""Export everything the static website (docs/) needs as plain JSON:

  docs/data/model.json        - the trained model, as a JS-scorable tree dump
  docs/data/teams.json        - team names/colors/logos
  docs/data/games_index.json  - browsable list of historical games (replay picker)
  docs/data/games/<season>.json - full play-by-play sequence per game, for replay
  docs/data/sim_tables.json   - drive-outcome Monte Carlo tables for the simulator

Run `scripts/train.py` first so models/run_pass_model.json(+_features.json) exist.

Usage:
    python scripts/export_site_data.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import nflreadpy as nfl
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nfl_predictor import data, features, model as model_mod  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DOCS_DATA = ROOT / "docs" / "data"
GAMES_DIR = DOCS_DATA / "games"

REPLAY_SEASONS = [2023, 2024, 2025]  # browsable in the "Replay" tab
SIM_SEASONS = [2021, 2022, 2023, 2024, 2025]  # drive-outcome tables for "Simulate"

ESPN_ABBR_FIX = {"LA": "LAR", "WAS": "WSH"}  # nflverse -> espn, for documentation


# ---------------------------------------------------------------------------
# model.json
# ---------------------------------------------------------------------------


def export_model() -> None:
    clf = model_mod.load_model()
    meta = model_mod.load_feature_metadata()
    booster = clf.get_booster()
    trees = [json.loads(t) for t in booster.get_dump(dump_format="json")]
    base_score = float(clf.get_params()["base_score"][0])

    payload = {
        "base_score": base_score,
        "feature_columns": meta["feature_columns"],
        "personnel_categories": meta["personnel_categories"],
        "trees": trees,
    }
    out_path = DOCS_DATA / "model.json"
    out_path.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"  {out_path} ({out_path.stat().st_size / 1024:.0f} KB, {len(trees)} trees)")


# ---------------------------------------------------------------------------
# teams.json
# ---------------------------------------------------------------------------


LEGACY_ABBRS = {"LAR", "OAK", "SD", "STL"}  # superseded by LA/LV/LAC/current nflverse codes


def export_teams() -> None:
    teams = nfl.load_teams().to_pandas()
    teams = teams[~teams["team_abbr"].isin(LEGACY_ABBRS)]
    records = []
    for _, row in teams.drop_duplicates(subset=["team_abbr"]).iterrows():
        records.append(
            {
                "abbr": row["team_abbr"],
                "name": row["team_name"],
                "color": row["team_color"],
                "color2": row["team_color2"],
                "logo": row["team_logo_espn"],
            }
        )
    out_path = DOCS_DATA / "teams.json"
    out_path.write_text(json.dumps(records, separators=(",", ":")))
    print(f"  {out_path} ({len(records)} teams)")


# ---------------------------------------------------------------------------
# games_index.json + games/<season>.json
# ---------------------------------------------------------------------------

_PERSONNEL_RE = re.compile(r"(\d+)\s*(RB|TE)")


def _parse_personnel_group(value: object) -> str:
    if not isinstance(value, str):
        return "UNK"
    counts = {"RB": "0", "TE": "0"}
    for count, unit in _PERSONNEL_RE.findall(value):
        counts[unit] = count
    return f"{counts['RB']}{counts['TE']}"


def export_games() -> None:
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    games_index = []

    for season in REPLAY_SEASONS:
        raw = data.load_pbp_with_personnel([season])
        plays = raw[raw["play_type"].isin(["run", "pass"])].copy()
        plays = plays[plays["down"].notna() & plays["score_differential"].notna()]
        plays["personnel_group"] = plays["offense_personnel"].apply(_parse_personnel_group)

        season_games = {}
        for game_id, game_plays in plays.groupby("game_id"):
            game_plays = game_plays.sort_values("play_id")
            first = game_plays.iloc[0]
            last = game_plays.iloc[-1]
            season_games[game_id] = {
                "game_id": game_id,
                "season": int(first["season"]),
                "week": int(first["week"]),
                "home_team": None,  # filled from schedule below
                "away_team": None,
                "plays": [
                    {
                        "down": int(r["down"]),
                        "ydstogo": int(min(r["ydstogo"], 30)),
                        "yardline_100": None if pd.isna(r["yardline_100"]) else float(r["yardline_100"]),
                        "score_differential": float(r["score_differential"]),
                        "game_seconds_remaining": float(r["game_seconds_remaining"]),
                        "qtr": int(r["qtr"]),
                        "personnel_group": r["personnel_group"],
                        "posteam": r["posteam"],
                        "defteam": r["defteam"],
                        "actual": "pass" if r["play_type"] == "pass" else "run",
                        "home_score": int(r["posteam_score"]) if r["posteam"] == r["home_team"] else int(r["defteam_score"]),
                        "away_score": int(r["defteam_score"]) if r["posteam"] == r["home_team"] else int(r["posteam_score"]),
                    }
                    for _, r in game_plays.iterrows()
                    if pd.notna(r["game_seconds_remaining"])
                ],
            }

        schedules = nfl.load_schedules(seasons=[season]).to_pandas()
        for _, s in schedules.iterrows():
            gid = s["game_id"]
            if gid in season_games:
                season_games[gid]["home_team"] = s["home_team"]
                season_games[gid]["away_team"] = s["away_team"]
                season_games[gid]["home_score"] = None if pd.isna(s["home_score"]) else int(s["home_score"])
                season_games[gid]["away_score"] = None if pd.isna(s["away_score"]) else int(s["away_score"])
                season_games[gid]["gameday"] = s["gameday"]

        out_path = GAMES_DIR / f"{season}.json"
        out_path.write_text(json.dumps(list(season_games.values()), separators=(",", ":")))
        print(f"  {out_path} ({len(season_games)} games, {out_path.stat().st_size / 1024:.0f} KB)")

        for g in season_games.values():
            if not g["plays"]:
                continue
            games_index.append(
                {
                    "game_id": g["game_id"],
                    "season": g["season"],
                    "week": g["week"],
                    "home_team": g["home_team"],
                    "away_team": g["away_team"],
                    "home_score": g.get("home_score"),
                    "away_score": g.get("away_score"),
                    "gameday": g.get("gameday"),
                    "n_plays": len(g["plays"]),
                }
            )

    games_index.sort(key=lambda g: (g["season"], g["week"], g["game_id"]))
    out_path = DOCS_DATA / "games_index.json"
    out_path.write_text(json.dumps(games_index, separators=(",", ":")))
    print(f"  {out_path} ({len(games_index)} games total)")


# ---------------------------------------------------------------------------
# sim_tables.json - drive-outcome Monte Carlo tables
# ---------------------------------------------------------------------------

FIELD_BUCKETS = [
    (0, 20, "redzone"),
    (20, 40, "plus_territory"),
    (40, 60, "midfield"),
    (60, 80, "own_territory"),
    (80, 101, "own_deep"),
]


def _field_bucket(yardline_100: float) -> str:
    for lo, hi, name in FIELD_BUCKETS:
        if lo <= yardline_100 < hi:
            return name
    return "own_deep"


def _parse_top_to_seconds(top: object) -> float | None:
    if not isinstance(top, str) or ":" not in top:
        return None
    m, s = top.split(":")
    try:
        return int(m) * 60 + int(s)
    except ValueError:
        return None


def export_sim_tables() -> None:
    frames = [nfl.load_pbp(seasons=[s]).to_pandas() for s in SIM_SEASONS]
    pbp = pd.concat(frames, ignore_index=True)

    drives = pbp.dropna(subset=["fixed_drive", "posteam", "defteam", "yardline_100"])
    drives = drives.sort_values(["game_id", "play_id"]).groupby(
        ["game_id", "fixed_drive"], as_index=False
    ).first()

    drives = drives[drives["fixed_drive_result"].notna()]
    drives["field_bucket"] = drives["yardline_100"].apply(_field_bucket)
    drives["duration_s"] = drives["drive_time_of_possession"].apply(_parse_top_to_seconds)

    result_map = drives["fixed_drive_result"]
    drives["outcome"] = np.select(
        [
            result_map == "Touchdown",
            result_map == "Field goal",
            result_map == "Safety",
            result_map == "Opp touchdown",
        ],
        ["TD", "FG", "SAFETY", "DEF_TD"],
        default="NO_SCORE",
    )
    drives["points_for"] = drives["outcome"].map({"TD": 6.94, "FG": 3.0}).fillna(0.0)

    league_avg_points_for = drives["points_for"].mean()

    # league-wide distribution of drive-start field position
    start_dist = (
        drives["field_bucket"].value_counts(normalize=True).to_dict()
    )

    # per-field-bucket outcome distribution + median drive duration
    bucket_outcomes = {}
    default_duration = float(drives["duration_s"].dropna().median())
    for lo, hi, name in FIELD_BUCKETS:
        sub = drives[drives["field_bucket"] == name]
        counts = sub["outcome"].value_counts(normalize=True)
        duration = sub["duration_s"].dropna().median()
        bucket_outcomes[name] = {
            "TD": float(counts.get("TD", 0.0)),
            "FG": float(counts.get("FG", 0.0)),
            "SAFETY": float(counts.get("SAFETY", 0.0)),
            "DEF_TD": float(counts.get("DEF_TD", 0.0)),
            "NO_SCORE": float(counts.get("NO_SCORE", 0.0)),
            "median_duration_s": float(duration) if pd.notna(duration) else default_duration,
            "n_drives": int(len(sub)),
        }

    # team offense/defense indices, relative to league average points-for-per-drive
    off_pts = drives.groupby("posteam")["points_for"].mean()
    def_allow_pts = drives.groupby("defteam")["points_for"].mean()

    MIN_DRIVES = 30
    off_counts = drives.groupby("posteam").size()
    def_counts = drives.groupby("defteam").size()

    team_indices = {}
    for team in sorted(set(off_pts.index) | set(def_allow_pts.index)):
        off_idx = (
            float(off_pts.get(team, league_avg_points_for) / league_avg_points_for)
            if off_counts.get(team, 0) >= MIN_DRIVES
            else 1.0
        )
        def_idx = (
            float(def_allow_pts.get(team, league_avg_points_for) / league_avg_points_for)
            if def_counts.get(team, 0) >= MIN_DRIVES
            else 1.0
        )
        team_indices[team] = {"offense_index": round(off_idx, 4), "defense_allow_index": round(def_idx, 4)}

    payload = {
        "seasons": SIM_SEASONS,
        "field_buckets": [b[2] for b in FIELD_BUCKETS],
        "start_distribution": {k: float(v) for k, v in start_dist.items()},
        "bucket_outcomes": bucket_outcomes,
        "league_avg_points_for": float(league_avg_points_for),
        "team_indices": team_indices,
        "min_drives_for_team_index": MIN_DRIVES,
    }
    out_path = DOCS_DATA / "sim_tables.json"
    out_path.write_text(json.dumps(payload, indent=None, separators=(",", ":")))
    print(f"  {out_path} ({len(drives)} drives, {out_path.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    print("Exporting model...")
    export_model()
    print("Exporting teams...")
    export_teams()
    print("Exporting replay games...")
    export_games()
    print("Exporting simulator drive tables...")
    export_sim_tables()


if __name__ == "__main__":
    main()
