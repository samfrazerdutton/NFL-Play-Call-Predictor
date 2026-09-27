"""Train and persist the XGBoost run/pass play-call model."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from xgboost import XGBClassifier

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"

DEFAULT_PARAMS = {
    "n_estimators": 300,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "eval_metric": "logloss",
    "random_state": 42,
}


def split_by_game(
    df: pd.DataFrame, test_size: float = 0.2, random_state: int = 42
):
    """Group-split so all plays from a game land on the same side."""
    splitter = GroupShuffleSplit(
        n_splits=1, test_size=test_size, random_state=random_state
    )
    train_idx, test_idx = next(splitter.split(df, groups=df["game_id"]))
    return df.iloc[train_idx].reset_index(drop=True), df.iloc[test_idx].reset_index(
        drop=True
    )


def train_model(X_train: pd.DataFrame, y_train: pd.Series, **params) -> XGBClassifier:
    model = XGBClassifier(**{**DEFAULT_PARAMS, **params})
    model.fit(X_train, y_train)
    return model


def save_model(model: XGBClassifier, name: str = "run_pass_model") -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = MODELS_DIR / f"{name}.json"
    model.save_model(path)
    return path


def load_model(name: str = "run_pass_model") -> XGBClassifier:
    model = XGBClassifier()
    model.load_model(MODELS_DIR / f"{name}.json")
    return model


def save_feature_metadata(
    feature_columns: list[str],
    personnel_categories: list[str],
    name: str = "run_pass_model",
) -> Path:
    """Persist the exact feature order + personnel category set used at
    training time, so any downstream consumer (evaluation, JS export, live
    inference) can reproduce the same encoding deterministically."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = MODELS_DIR / f"{name}_features.json"
    path.write_text(
        json.dumps(
            {
                "feature_columns": feature_columns,
                "personnel_categories": personnel_categories,
            },
            indent=2,
        )
    )
    return path


def load_feature_metadata(name: str = "run_pass_model") -> dict:
    path = MODELS_DIR / f"{name}_features.json"
    return json.loads(path.read_text())
