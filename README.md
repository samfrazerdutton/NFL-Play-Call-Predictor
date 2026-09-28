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
3. **Model** — an `XGBClassifier` (gradient boosted trees), validated with a
   **time-based split**: trained on every season strictly before the test
   season, tested only on the held-out season that follows (default: train
   2016–2024, test 2025). No future data ever informs training — see the
   site's **Model** tab for accuracy, log-loss, a calibration/reliability
   diagram, a confusion matrix, and accuracy by down.
4. **Predictability ranking** — for each team's held-out (2025) offensive
   plays, the model's log-loss/accuracy measures how closely that offense's
   actual calls track the league-wide situational norm. Low log-loss = the
   offense plays "by the book" for the situation (predictable); high
   log-loss = the offense deviates from what down/distance/field
   position/score/time/personnel would suggest (less predictable / more
   creative play-calling).
5. **Situational splits** — real (not model-derived) play-calling and EPA
   splits per team by down, distance, red zone, two-minute drill, and
   score state, computed directly from 2023–2025 play-by-play. EPA is
   [nflverse's](https://www.nflfastr.com/articles/nflfastR.html#expected-points-and-win-probability)
   own expected-points-added model, not something this project computes.

## Website

A static site in `docs/` (served free by GitHub Pages, no backend) puts the
model in front of five interactive views. The centerpiece is **Situation**:
one persistent game state (down, distance, field position, score, clock)
drives everything below it — a field diagram, a live play-call distribution,
a "Why" panel that explains the number with real computed evidence (not
generated text), a What-If comparator, and a historical-comparables search
across 100k+ real plays. The same game state can come from two places:
hand-built with the controls, or scrubbed from a real 2023–2025 game via a
**Game Center**: a drive-by-drive timeline (each drive its actual nflverse
result — punt, TD, FG, turnover) and a play list inside it, both clickable,
both driving the same scrubber.

- **Situation** — build any down/distance/field-position/score/clock
  combination, or open a real game's Game Center and click through its
  drives and plays, and watch the field, the pass/run odds, the evidence
  behind them, and comparable historical plays recompute live. Clone the
  current situation into a "what if" and see exactly how much each change
  moves the model.
- **Live** — polls [ESPN's public scoreboard API](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard)
  directly from your browser (no server of ours involved, so it's free and
  needs no API key) and predicts the next call for any in-progress game from
  its current down/distance/field position/score/time.
- **Simulate** — runs a client-side Monte Carlo simulation of a full game
  (thousands of trials) by resampling real 2021–2025 drive outcomes by
  starting field position, scaled by each team's own offensive/defensive
  drive-scoring rates, to produce a win-probability estimate for any matchup.
  Two what-if sliders (scoring rate, turnover/pick-six rate) let you rerun
  the same matchup under different assumptions and see baseline vs.
  modified win probabilities and average scores side by side.
- **Teams** — real situational play-calling + EPA splits per team (by down,
  distance, red zone, two-minute drill, score state), each compared against
  the league baseline, plus that team's predictability rank.
- **Stats** — a custom stat calculator: filter every 2023–2025 play by team,
  opponent, down, distance, field position, score state, quarter, and play
  type, and get back a real sample size, pass rate, yards/play, EPA/play,
  and success rate — computed client-side, not looked up from a canned
  table. Export the filtered plays as CSV, or copy a link that reproduces
  the exact query.
- **Model** — full transparency on the classifier itself: accuracy,
  log-loss, Brier score, a calibration/reliability diagram, a confusion
  matrix, and accuracy by down — all on the 2025 season the model never
  trained on.

Everything the site needs — the trained model (as a JSON tree dump the
browser scores directly, no ML runtime required), team info, a browsable
slice of historical games, the simulator's drive-outcome tables, situational
splits, and the model evaluation report — is static JSON exported by
`scripts/export_site_data.py`. Nothing runs server-side; the browser does
all the inference, aggregation, and simulation.

### Regenerating the site's data

```bash
python scripts/train.py --start-season 2016 --end-season 2025
python scripts/export_site_data.py
```

### Viewing it locally

```bash
cd docs && python -m http.server 8000
```

then open `http://localhost:8000`. (Plain `file://` won't work — the
browser needs to `fetch()` the JSON files over HTTP.)

### Publishing it

In the repo's GitHub Settings → Pages, set **Source** to "Deploy from a
branch", branch `main`, folder `/docs`. The site will be live at
`https://<username>.github.io/NFL-Play-Call-Predictor/` within a couple of
minutes, and stays free — GitHub Pages serves static files directly, and the
live-game feature calls ESPN's API from each visitor's own browser rather
than through any server you'd have to run or pay for.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

## Usage

```bash
python scripts/train.py --start-season 2016 --end-season 2025
```

By default this trains on every season before `--test-season` (which
defaults to `--end-season`) and validates only on that held-out season —
pass `--split-mode random` to fall back to the old random game-level split
(kept for comparison, not recommended as the reported metric). This will:
- download and cache play-by-play + participation data to `data/`
- train the model and save it to `models/run_pass_model.json` (plus
  `models/run_pass_model_features.json`, the exact feature order/personnel
  categories used — needed by `export_site_data.py`)
- print test accuracy/log-loss and the top-5 most/least predictable offenses
- write `output/feature_importance.png`, `output/team_predictability.png`,
  `output/team_predictability.csv`, and `output/model_eval.json` (the full
  evaluation report the site's Model tab reads)

Pass `--no-cache` to force a fresh data pull. Seasons before 2016 don't have
personnel participation data available and will fall back to an `UNK`
personnel group.

## Project layout

```
src/nfl_predictor/
  data.py          # nflreadpy loading + parquet caching
  features.py      # filtering + feature engineering
  model.py         # train/save/load the XGBoost model, time-based split
  evaluate.py       # predictability ranking + model evaluation report
  visualize.py      # matplotlib charts
scripts/
  train.py             # end-to-end training pipeline
  export_site_data.py  # exports docs/data/*.json for the website
docs/                # static site (GitHub Pages) — see "Website" above
  index.html, styles.css
  js/model.js         # in-browser XGBoost tree scorer (no ML runtime)
  js/data-loader.js   # shared fetch/team helpers
  js/situation.js      # game state + field + why + what-if + comparables
  js/live.js            # live ESPN-polling tab
  js/simulate.js         # Monte Carlo game simulator tab
  js/teams.js            # situational splits + predictability tab
  js/stats.js              # custom stat calculator tab
  js/model-eval.js       # model evaluation/calibration tab
  data/                # generated — model.json, teams.json, games/, sim_tables.json,
                        # team_splits.json, model_eval.json, team_predictability.json
```

## Known limitations

- QB scrambles on designed pass plays are recorded as `run` in nflverse
  play-by-play data, which adds some label noise to the run/pass target.
- Garbage-time plays (e.g. running out the clock with a big lead) are not
  filtered out, which can make some offenses look more "predictable" than
  their competitive-snap tendencies would suggest.
- Teams with fewer than 100 held-out plays in a given run are excluded from
  the predictability ranking to avoid small-sample noise.
- ESPN's live feed doesn't report offensive personnel groupings, so the
  **Live** tab predicts using a user-selectable assumed personnel package
  (default: 11) rather than the actual grouping on the field.
- The **Simulate** tab's Monte Carlo model resamples each new drive's
  starting field position from the league-wide distribution rather than
  chaining it exactly from the prior play's result, doesn't team-adjust
  red-zone conversion rate separately from overall scoring, and uses a
  simplified sudden-death overtime (not full NFL OT rules) — it's a
  reasonable estimate, not a betting-grade simulation.
- ESPN's scoreboard/summary endpoints are public but unofficial and
  undocumented; if ESPN changes their response format, the **Live** tab may
  need updating.
- Situational split cells (Teams tab) with fewer than 15 plays are flagged
  "low n" rather than hidden — read them as directional, not reliable.
- The model is a gradient-boosted tree ensemble over hand-picked situational
  features, not a language model — nothing on this site is generative AI,
  and every number is a directly computed statistic or model output, not a
  generated explanation.
- The **Situation** tab's "Why" panel shows one-at-a-time counterfactuals
  (swap a single feature to a neutral reference value, hold everything else
  at its current value, see how much the model's output moves) plus real
  team/league situational splits — it's a local sensitivity readout, not a
  formal causal decomposition, and factors aren't guaranteed to sum to the
  total probability the way a proper Shapley/SHAP attribution would.
- "Similar situations" ranks by a simple hand-weighted distance across down,
  distance, field position, score, and time — not a calibrated nearest-
  neighbor model.
