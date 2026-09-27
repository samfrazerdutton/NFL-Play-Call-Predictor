"""Feature engineering for the run/pass play-call model."""

from __future__ import annotations

import re

import pandas as pd

FEATURE_COLUMNS = [
    "down",
    "ydstogo",
    "yardline_100",
    "score_differential",
    "game_seconds_remaining",
    "qtr",
    "personnel_group",
]

TARGET_COLUMN = "is_pass"

_PERSONNEL_RE = re.compile(r"(\d+)\s*(RB|TE)")


def _parse_personnel_group(value: object) -> str:
    """Collapse a raw personnel string into a standard "RB-TE" code.

    e.g. "1 RB, 1 TE, 3 WR" -> "11", "2 RB, 1 TE, 2 WR" -> "21".
    Falls back to "UNK" when personnel data is missing.
    """
    if not isinstance(value, str):
        return "UNK"
    counts = {"RB": "0", "TE": "0"}
    for count, unit in _PERSONNEL_RE.findall(value):
        counts[unit] = count
    return f"{counts['RB']}{counts['TE']}"


def build_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """Filter to designed rush/pass plays and engineer model features."""
    plays = df[df["play_type"].isin(["run", "pass"])].copy()
    plays = plays[plays["down"].notna()]
    plays = plays[plays["score_differential"].notna()]
    plays = plays[plays["game_seconds_remaining"].notna()]

    plays["down"] = plays["down"].astype(int)
    plays["ydstogo"] = plays["ydstogo"].clip(upper=30).astype(int)
    plays["personnel_group"] = plays["offense_personnel"].apply(
        _parse_personnel_group
    )
    plays[TARGET_COLUMN] = (plays["play_type"] == "pass").astype(int)

    keep = FEATURE_COLUMNS + [
        TARGET_COLUMN,
        "posteam",
        "defteam",
        "season",
        "week",
        "game_id",
        "play_id",
    ]
    return plays[keep].reset_index(drop=True)


def encode_features(df: pd.DataFrame, personnel_categories: list[str] | None = None):
    """One-hot encode the personnel group, leave numeric features as-is.

    Returns (X, personnel_categories) so the same category set can be
    reapplied consistently at inference time.
    """
    if personnel_categories is None:
        personnel_categories = sorted(df["personnel_group"].unique())

    personnel_dummies = pd.get_dummies(
        pd.Categorical(df["personnel_group"], categories=personnel_categories),
        prefix="personnel",
        dtype="int8",
    )
    numeric = df[
        [
            "down",
            "ydstogo",
            "yardline_100",
            "score_differential",
            "game_seconds_remaining",
            "qtr",
        ]
    ].reset_index(drop=True)
    X = pd.concat([numeric, personnel_dummies.reset_index(drop=True)], axis=1)
    return X, personnel_categories
