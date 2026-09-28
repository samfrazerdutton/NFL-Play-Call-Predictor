"""Load and cache NFL play-by-play + participation data via nflreadpy."""

from __future__ import annotations

from pathlib import Path

import nflreadpy as nfl
import pandas as pd

CACHE_DIR = Path(__file__).resolve().parents[2] / "data"

PBP_COLUMNS = [
    "game_id",
    "play_id",
    "season",
    "week",
    "season_type",
    "posteam",
    "defteam",
    "home_team",
    "away_team",
    "posteam_score",
    "defteam_score",
    "down",
    "ydstogo",
    "yardline_100",
    "score_differential",
    "game_seconds_remaining",
    "qtr",
    "play_type",
    "rush_attempt",
    "pass_attempt",
    "qb_kneel",
    "qb_spike",
    "two_point_attempt",
    "sack",
    "epa",
    "touchdown",
    "yards_gained",
    "desc",
]


def _cache_path(kind: str, seasons: list[int]) -> Path:
    season_tag = f"{min(seasons)}-{max(seasons)}"
    return CACHE_DIR / f"{kind}_{season_tag}.parquet"


def load_pbp_with_personnel(
    seasons: list[int], use_cache: bool = True
) -> pd.DataFrame:
    """Load play-by-play data joined with offense personnel groupings.

    Returns one row per rush/pass play with situational columns plus
    `offense_personnel` (raw string, e.g. "1 RB, 1 TE, 3 WR").
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path("pbp_participation", seasons)
    if use_cache and cache_file.exists():
        return pd.read_parquet(cache_file)

    pbp = nfl.load_pbp(seasons=seasons).select(PBP_COLUMNS)
    participation = nfl.load_participation(seasons=seasons).select(
        ["nflverse_game_id", "play_id", "offense_personnel"]
    )

    merged = pbp.join(
        participation,
        left_on=["game_id", "play_id"],
        right_on=["nflverse_game_id", "play_id"],
        how="left",
    )

    df = merged.to_pandas()
    df.to_parquet(cache_file, index=False)
    return df
