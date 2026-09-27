"""Matplotlib charts: feature importance and offense predictability ranking."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRIDLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
SURFACE = "#fcfcfb"
BLUE = "#2a78d6"
RED = "#e34948"


def _style_axes(ax, x_gridlines: bool = True):
    ax.set_facecolor(SURFACE)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(BASELINE)
    ax.tick_params(colors=INK_MUTED, length=0)
    if x_gridlines:
        ax.xaxis.grid(True, color=GRIDLINE, linewidth=0.8)
        ax.set_axisbelow(True)


def plot_feature_importance(
    model, feature_names: list[str], top_n: int = 15, filename: str = "feature_importance.png"
) -> Path:
    importances = pd.Series(model.feature_importances_, index=feature_names)
    importances = importances.sort_values(ascending=True).tail(top_n)

    fig, ax = plt.subplots(figsize=(8, 0.35 * len(importances) + 1.5), facecolor=SURFACE)
    ax.barh(importances.index, importances.values, color=BLUE, height=0.6)
    ax.set_title(
        "What drives the run/pass call?", color=INK_PRIMARY, fontsize=13, loc="left", pad=12
    )
    ax.set_xlabel("XGBoost feature importance (gain)", color=INK_SECONDARY, fontsize=9)
    ax.tick_params(axis="y", colors=INK_PRIMARY, labelsize=9)
    _style_axes(ax)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / filename
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    return out_path


def plot_team_predictability(
    table: pd.DataFrame, filename: str = "team_predictability.png"
) -> Path:
    """Horizontal bar chart of teams ranked from most to least predictable.

    Bars are ordered top-to-bottom from most predictable (lowest log-loss)
    to least predictable (highest log-loss).
    """
    # Ascending log_loss, then reversed so index 0 (most predictable) ends
    # up last in the list -> plotted at the top of a matplotlib barh.
    ordered = table.sort_values("log_loss", ascending=True).iloc[::-1].reset_index(drop=True)

    most_predictable_pos = len(ordered) - 1
    least_predictable_pos = 0

    colors = [BLUE] * len(ordered)
    if len(ordered) >= 2:
        colors[most_predictable_pos] = BLUE
        colors[least_predictable_pos] = RED

    fig, ax = plt.subplots(figsize=(8, 0.3 * len(ordered) + 1.5), facecolor=SURFACE)
    ax.barh(ordered["team"], ordered["log_loss"], color=colors, height=0.65)
    ax.set_title(
        "Offense predictability: model log-loss by team",
        color=INK_PRIMARY,
        fontsize=13,
        loc="left",
        pad=12,
    )
    ax.set_xlabel(
        "Log-loss (lower = play calls match situational norms more closely)",
        color=INK_SECONDARY,
        fontsize=9,
    )
    ax.tick_params(axis="y", colors=INK_PRIMARY, labelsize=8)
    _style_axes(ax)

    if len(ordered) >= 2:
        ax.text(
            ordered["log_loss"].iloc[least_predictable_pos],
            least_predictable_pos,
            "  least predictable",
            va="center", ha="left", color=RED, fontsize=8,
        )
        ax.text(
            ordered["log_loss"].iloc[most_predictable_pos],
            most_predictable_pos,
            "  most predictable",
            va="center", ha="left", color=BLUE, fontsize=8,
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / filename
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    return out_path
