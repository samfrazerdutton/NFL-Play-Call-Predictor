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

## Website

A static site in `docs/` (served free by GitHub Pages, no backend) puts the
model in front of three interactive views:

- **Replay** — step through any 2023–2025 game play-by-play, seeing the
  model's pre-snap prediction next to what the offense actually called.
- **Live** — polls [ESPN's public scoreboard API](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard)
  directly from your browser (no server of ours involved, so it's free and
  needs no API key) and predicts the next call for any in-progress game from
  its current down/distance/field position/score/time.
- **Simulate** — runs a client-side Monte Carlo simulation of a full game
  (thousands of trials) by resampling real 2021–2025 drive outcomes by
  starting field position, scaled by each team's own offensive/defensive
  drive-scoring rates, to produce a win-probability estimate for any matchup.

Everything the site needs — the trained model (as a JSON tree dump the
browser scores directly, no ML runtime required), team info, a browsable
slice of historical games, and the simulator's drive-outcome tables — is
static JSON exported by `scripts/export_site_data.py`. Nothing runs
server-side; the browser does all the inference and simulation.

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
python scripts/train.py --start-season 2018 --end-season 2023
```

This will:
- download and cache play-by-play + participation data to `data/`
- train the model and save it to `models/run_pass_model.json` (plus
  `models/run_pass_model_features.json`, the exact feature order/personnel
  categories used — needed by `export_site_data.py`)
- print test accuracy/log-loss and the top-5 most/least predictable offenses
- write `output/feature_importance.png`, `output/team_predictability.png`,
  and `output/team_predictability.csv`

Pass `--no-cache` to force a fresh data pull. Seasons before 2016 don't have
personnel participation data available and will fall back to an `UNK`
personnel group.

## Project layout

```
src/nfl_predictor/
  data.py          # nflreadpy loading + parquet caching
  features.py      # filtering + feature engineering
  model.py         # train/save/load the XGBoost model
  evaluate.py       # per-team predictability metrics
  visualize.py      # matplotlib charts
scripts/
  train.py             # end-to-end training pipeline
  export_site_data.py  # exports docs/data/*.json for the website
docs/                # static site (GitHub Pages) — see "Website" above
  index.html, styles.css
  js/model.js         # in-browser XGBoost tree scorer (no ML runtime)
  js/data-loader.js   # shared fetch/team helpers
  js/replay.js         # historical replay tab
  js/live.js            # live ESPN-polling tab
  js/simulate.js         # Monte Carlo game simulator tab
  data/                # generated — model.json, teams.json, games/, sim_tables.json
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
