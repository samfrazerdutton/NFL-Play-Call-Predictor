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


def model_evaluation_report(
    test_df: pd.DataFrame,
    y_true: pd.Series,
    y_pred_proba: np.ndarray,
    train_seasons: list[int],
    test_season: int,
    n_train: int,
) -> dict:
    """Build the full transparency report for the site's Model tab: overall
    metrics, a confusion matrix, a calibration/reliability table, and
    accuracy broken down by down - all computed on the time-based held-out
    test season only (never seen during training)."""
    eps = 1e-15
    y_true_arr = y_true.to_numpy()
    proba = np.clip(y_pred_proba, eps, 1 - eps)
    y_pred = (proba >= 0.5).astype(int)

    tp = int(((y_pred == 1) & (y_true_arr == 1)).sum())
    tn = int(((y_pred == 0) & (y_true_arr == 0)).sum())
    fp = int(((y_pred == 1) & (y_true_arr == 0)).sum())
    fn = int(((y_pred == 0) & (y_true_arr == 1)).sum())

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    # Calibration: does "70% pass" actually mean ~70% pass in practice?
    n_bins = 10
    bin_edges = np.linspace(0, 1, n_bins + 1)
    bin_idx = np.clip(np.digitize(proba, bin_edges[1:-1]), 0, n_bins - 1)
    calibration = []
    for b in range(n_bins):
        mask = bin_idx == b
        n = int(mask.sum())
        calibration.append(
            {
                "bucket_low": round(float(bin_edges[b]), 2),
                "bucket_high": round(float(bin_edges[b + 1]), 2),
                "predicted_mean": round(float(proba[mask].mean()), 4) if n else None,
                "actual_rate": round(float(y_true_arr[mask].mean()), 4) if n else None,
                "n": n,
            }
        )

    by_down = {}
    for down in sorted(test_df["down"].unique()):
        mask = (test_df["down"] == down).to_numpy()
        n = int(mask.sum())
        if n == 0:
            continue
        by_down[str(int(down))] = {
            "n": n,
            "accuracy": round(float(accuracy_score(y_true_arr[mask], y_pred[mask])), 4),
            "log_loss": round(float(log_loss(y_true_arr[mask], proba[mask], labels=[0, 1])), 4),
            "actual_pass_rate": round(float(y_true_arr[mask].mean()), 4),
        }

    return {
        "train_seasons": train_seasons,
        "test_season": test_season,
        "n_train": n_train,
        "n_test": len(y_true_arr),
        "accuracy": round(float(accuracy_score(y_true_arr, y_pred)), 4),
        "log_loss": round(float(log_loss(y_true_arr, proba, labels=[0, 1])), 4),
        "brier_score": round(float(brier_score_loss(y_true_arr, proba)), 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "confusion_matrix": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
        "calibration": calibration,
        "by_down": by_down,
        "baseline_pass_rate": round(float(y_true_arr.mean()), 4),
    }
