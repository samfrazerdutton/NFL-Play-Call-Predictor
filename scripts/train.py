"""End-to-end pipeline: load data, train the run/pass model, rank offense
predictability, and write charts + tables to output/.

Usage:
    python scripts/train.py --start-season 2018 --end-season 2023
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sklearn.metrics import accuracy_score, log_loss

from nfl_predictor import data, evaluate, features, model, visualize

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-season", type=int, default=2016)
    parser.add_argument("--end-season", type=int, default=2025)
    parser.add_argument(
        "--test-season",
        type=int,
        default=None,
        help="Held-out season for time-based validation (default: --end-season). "
        "Every earlier season in range is used for training; nothing from "
        "the test season or later ever informs training.",
    )
    parser.add_argument(
        "--split-mode",
        choices=["time", "random"],
        default="time",
        help="'time' (default): train on seasons before --test-season, test on "
        "it - the number that should be reported as real-world accuracy. "
        "'random': legacy game-level random split, kept for comparison only.",
    )
    parser.add_argument("--no-cache", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    seasons = list(range(args.start_season, args.end_season + 1))
    test_season = args.test_season or args.end_season
    if args.split_mode == "time" and test_season <= args.start_season:
        raise SystemExit("--test-season must be later than --start-season for a time-based split")

    print(f"Loading play-by-play + participation for seasons {seasons}...")
    raw = data.load_pbp_with_personnel(seasons, use_cache=not args.no_cache)
    print(f"  {len(raw):,} raw plays loaded")

    plays = features.build_dataset(raw)
    print(f"  {len(plays):,} rush/pass plays after filtering")

    if args.split_mode == "time":
        train_df, test_df = model.split_by_time(plays, test_season)
        print(f"  split: time-based, train seasons < {test_season}, test season == {test_season}")
    else:
        train_df, test_df = model.split_by_game(plays)
        print("  split: random game-level (legacy)")
    print(f"  train: {len(train_df):,} plays | test: {len(test_df):,} plays")

    # Fix the personnel category set from the FULL dataset (not just train),
    # so it's stable across re-splits and matches what the site's live/sim
    # export expects downstream.
    _, personnel_categories = features.encode_features(plays)
    X_train, _ = features.encode_features(train_df, personnel_categories)
    X_test, _ = features.encode_features(test_df, personnel_categories)
    y_train = train_df[features.TARGET_COLUMN]
    y_test = test_df[features.TARGET_COLUMN]

    print("Training XGBoost classifier...")
    clf = model.train_model(X_train, y_train)
    model.save_model(clf)
    model.save_feature_metadata(list(X_train.columns), personnel_categories)

    pred_proba = clf.predict_proba(X_test)[:, 1]
    pred_label = (pred_proba >= 0.5).astype(int)
    print(f"  test accuracy: {accuracy_score(y_test, pred_label):.4f}")
    print(f"  test log-loss: {log_loss(y_test, pred_proba):.4f}")

    print("Ranking offense predictability...")
    table = evaluate.team_predictability(test_df, y_test, pred_proba)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    table.to_csv(OUTPUT_DIR / "team_predictability.csv", index=False)

    print("\nMost predictable offenses (lowest log-loss):")
    print(table.head(5)[["team", "n_plays", "accuracy", "log_loss"]].to_string(index=False))
    print("\nLeast predictable offenses (highest log-loss):")
    print(table.tail(5)[["team", "n_plays", "accuracy", "log_loss"]].to_string(index=False))

    train_seasons = sorted(train_df["season"].unique().tolist())
    eval_report = evaluate.model_evaluation_report(
        test_df, y_test, pred_proba, train_seasons, test_season, len(train_df)
    )
    (OUTPUT_DIR / "model_eval.json").write_text(json.dumps(eval_report, indent=2))
    print(f"\nModel eval report: {OUTPUT_DIR / 'model_eval.json'}")

    print("\nWriting charts...")
    fi_path = visualize.plot_feature_importance(clf, list(X_train.columns))
    pred_path = visualize.plot_team_predictability(table)
    print(f"  {fi_path}")
    print(f"  {pred_path}")
    print(f"  {OUTPUT_DIR / 'team_predictability.csv'}")


if __name__ == "__main__":
    main()
