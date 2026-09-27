"""Compare predicted vs. actual play calls to rank offense predictability."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss

MIN_PLAYS_PER_TEAM = 100


def team_predictability(
    test_df: pd.DataFrame, y_true: pd.Series, y_pred_proba: np.ndarray
) -> pd.DataFrame:
    """Rank offenses by how well the league-wide model predicts their calls.

    Low accuracy / high log-loss = the offense deviates from what situational
    norms (down, distance, field position, score, time, personnel) predict,
    i.e. a less predictable play-caller. High accuracy / low log-loss = the
    offense plays close to situational "script".
    """
    results = test_df[["posteam"]].copy()
    results["y_true"] = y_true.to_numpy()
    results["y_pred_proba"] = y_pred_proba
    results["y_pred"] = (results["y_pred_proba"] >= 0.5).astype(int)
    results["correct"] = (results["y_pred"] == results["y_true"]).astype(int)

    rows = []
    for team, group in results.groupby("posteam"):
        if len(group) < MIN_PLAYS_PER_TEAM:
            continue
        eps = 1e-15
        proba = np.clip(group["y_pred_proba"].to_numpy(), eps, 1 - eps)
        rows.append(
            {
                "team": team,
                "n_plays": len(group),
                "accuracy": accuracy_score(group["y_true"], group["y_pred"]),
                "log_loss": log_loss(group["y_true"], proba, labels=[0, 1]),
                "brier_score": brier_score_loss(group["y_true"], proba),
                "actual_pass_rate": group["y_true"].mean(),
            }
        )

    table = pd.DataFrame(rows).sort_values("log_loss").reset_index(drop=True)
    table["predictability_rank"] = table.index + 1
    return table
