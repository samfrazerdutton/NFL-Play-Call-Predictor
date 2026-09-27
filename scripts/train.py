"""End-to-end pipeline: load data, train the run/pass model, rank offense
predictability, and write charts + tables to output/.

Usage:
    python scripts/train.py --start-season 2018 --end-season 2023
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sklearn.metrics import accuracy_score, log_loss

from nfl_predictor import data, evaluate, features, model, visualize

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-season", type=int, default=2018)
    parser.add_argument("--end-season", type=int, default=2023)
    parser.add_argument("--no-cache", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    seasons = list(range(args.start_season, args.end_season + 1))

    print(f"Loading play-by-play + participation for seasons {seasons}...")
    raw = data.load_pbp_with_personnel(seasons, use_cache=not args.no_cache)
    print(f"  {len(raw):,} raw plays loaded")

    plays = features.build_dataset(raw)
    print(f"  {len(plays):,} rush/pass plays after filtering")

    train_df, test_df = model.split_by_game(plays)
    print(f"  train: {len(train_df):,} plays | test: {len(test_df):,} plays")

    X_train, personnel_categories = features.encode_features(train_df)
    X_test, _ = features.encode_features(test_df, personnel_categories)
    y_train = train_df[features.TARGET_COLUMN]
    y_test = test_df[features.TARGET_COLUMN]

    print("Training XGBoost classifier...")
    clf = model.train_model(X_train, y_train)
    model.save_model(clf)

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

    print("\nWriting charts...")
    fi_path = visualize.plot_feature_importance(clf, list(X_train.columns))
    pred_path = visualize.plot_team_predictability(table)
    print(f"  {fi_path}")
    print(f"  {pred_path}")
    print(f"  {OUTPUT_DIR / 'team_predictability.csv'}")


if __name__ == "__main__":
    main()
