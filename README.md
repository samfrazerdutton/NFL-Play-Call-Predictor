# NFL Play-Call Predictor

Predicts whether an NFL offense will run or pass on a given down, using only
the situational information available *before* the snap — then compares the
model's predictions to what offenses actually did to rank the most and least
predictable play-callers in the league.

## How it works

1. **Data** — play-by-play and personnel-participation data pulled via
   [`nflreadpy`](https://github.com/nflverse/nflreadpy) (the nflverse
   successor to `nfl_data_py`).
2. **Features** — for every designed rush/pass play:
   - `down`, `ydstogo` (distance)
   - `yardline_100` (field position)
   - `score_differential`
   - `game_seconds_remaining` (time remaining), `qtr`
   - `personnel_group` — offense personnel collapsed to the standard
     RB/TE shorthand (e.g. `11`, `12`, `21`), one-hot encoded
3. **Model** — an `XGBClassifier` (gradient boosted trees) trained on a
   game-level train/test split (no game's plays appear on both sides) to
   predict pass vs. run.
4. **Predictability ranking** — for each team's held-out offensive plays,
   the model's log-loss/accuracy measures how closely that offense's actual
   calls track the league-wide situational norm. Low log-loss = the offense
   plays "by the book" for the situation (predictable); high log-loss = the
   offense deviates from what down/distance/field position/score/time/
   personnel would suggest (less predictable / more creative play-calling).

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

## Usage

```bash
python scripts/train.py --start-season 2018 --end-season 2023
```

This will:
- download and cache play-by-play + participation data to `data/`
- train the model and save it to `models/run_pass_model.json`
- print test accuracy/log-loss and the top-5 most/least predictable offenses
- write `output/feature_importance.png`, `output/team_predictability.png`,
  and `output/team_predictability.csv`

Pass `--no-cache` to force a fresh data pull. Seasons before 2016 don't have
personnel participation data available and will fall back to an `UNK`
personnel group.

## Project layout

```
src/nfl_predictor/
  data.py        # nflreadpy loading + parquet caching
  features.py     # filtering + feature engineering
  model.py        # train/save/load the XGBoost model
  evaluate.py      # per-team predictability metrics
  visualize.py     # matplotlib charts
scripts/train.py   # end-to-end pipeline
```

## Known limitations

- QB scrambles on designed pass plays are recorded as `run` in nflverse
  play-by-play data, which adds some label noise to the run/pass target.
- Garbage-time plays (e.g. running out the clock with a big lead) are not
  filtered out, which can make some offenses look more "predictable" than
  their competitive-snap tendencies would suggest.
- Teams with fewer than 100 held-out plays in a given run are excluded from
  the predictability ranking to avoid small-sample noise.
