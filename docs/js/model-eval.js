// "Model" tab: transparent evaluation of the run/pass classifier on a
// held-out season it never trained on - accuracy, calibration, confusion
// matrix, and a by-down breakdown.

const ModelEval = (() => {
  async function init() {
    const evalReport = await NFLData.loadModelEval();
    render(evalReport);
  }

  function render(r) {
    document.getElementById("model-headline").textContent =
      `Validation: trained on ${r.train_seasons[0]}–${r.train_seasons[r.train_seasons.length - 1]}, tested on ${r.test_season}`;

    document.getElementById("model-stats").innerHTML = `
      <div class="stat"><div class="value">${Math.round(r.accuracy * 100)}%</div><div class="label">accuracy</div></div>
      <div class="stat"><div class="value">${r.log_loss.toFixed(3)}</div><div class="label">log-loss</div></div>
      <div class="stat"><div class="value">${r.brier_score.toFixed(3)}</div><div class="label">Brier score</div></div>
      <div class="stat"><div class="value">${r.n_test.toLocaleString()}</div><div class="label">held-out plays (${r.test_season})</div></div>
      <div class="stat"><div class="value">${r.n_train.toLocaleString()}</div><div class="label">training plays (${r.train_seasons[0]}–${r.train_seasons[r.train_seasons.length - 1]})</div></div>
      <div class="stat"><div class="value">${Math.round(r.baseline_pass_rate * 100)}%</div><div class="label">league pass rate (baseline)</div></div>
    `;

    renderConfusion(r);
    renderCalibration(r.calibration);
    renderByDown(r.by_down);
  }

  function renderConfusion(r) {
    const cm = r.confusion_matrix;
    document.querySelector("#model-confusion tbody").innerHTML = `
      <tr><th></th><th>Predicted RUN</th><th>Predicted PASS</th></tr>
      <tr><th>Actual RUN</th><td>${cm.tn.toLocaleString()}</td><td>${cm.fp.toLocaleString()}</td></tr>
      <tr><th>Actual PASS</th><td>${cm.fn.toLocaleString()}</td><td>${cm.tp.toLocaleString()}</td></tr>
    `;
    document.getElementById("model-prf").textContent =
      `Precision ${(r.precision * 100).toFixed(1)}%  ·  Recall ${(r.recall * 100).toFixed(1)}%  ·  F1 ${(r.f1 * 100).toFixed(1)}%  (positive class: PASS)`;
  }

  function renderByDown(byDown) {
    const rows = Object.entries(byDown)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([down, d]) => `
        <tr>
          <td>${ordinal(Number(down))}</td>
          <td>${d.n.toLocaleString()}</td>
          <td>${Math.round(d.accuracy * 100)}%</td>
          <td>${d.log_loss.toFixed(3)}</td>
          <td>${Math.round(d.actual_pass_rate * 100)}%</td>
        </tr>
      `)
      .join("");
    document.querySelector("#model-by-down tbody").innerHTML = rows;
  }

  function renderCalibration(bins) {
    const W = 320, H = 300, PAD = 34;
    const plotW = W - PAD * 2;
    const plotH = H - PAD * 2;
    const x = (v) => PAD + v * plotW;
    const y = (v) => H - PAD - v * plotH;

    const points = bins.filter((b) => b.n > 0);
    const path = points.map((b, i) => `${i === 0 ? "M" : "L"} ${x(b.predicted_mean).toFixed(1)} ${y(b.actual_rate).toFixed(1)}`).join(" ");
    const dots = points
      .map((b) => `<circle class="pt" cx="${x(b.predicted_mean).toFixed(1)}" cy="${y(b.actual_rate).toFixed(1)}" r="${Math.max(2.5, Math.min(7, Math.sqrt(b.n) / 8))}"><title>predicted ${(b.predicted_mean * 100).toFixed(0)}% / actual ${(b.actual_rate * 100).toFixed(0)}%, n=${b.n}</title></circle>`)
      .join("");

    const ticks = [0, 0.25, 0.5, 0.75, 1];
    const xTicks = ticks.map((t) => `<text class="axis-label" x="${x(t)}" y="${H - PAD + 16}" text-anchor="middle">${t}</text>`).join("");
    const yTicks = ticks.map((t) => `<text class="axis-label" x="${PAD - 8}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join("");

    const svg = `
      <svg class="calibration-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration chart: predicted pass probability vs actual pass rate, close to the diagonal means well-calibrated">
        <line class="diag" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" />
        <path class="curve" d="${path}" />
        ${dots}
        ${xTicks}
        ${yTicks}
        <text class="axis-label" x="${W / 2}" y="${H - 4}" text-anchor="middle">predicted P(pass)</text>
        <text class="axis-label" x="10" y="${H / 2}" text-anchor="middle" transform="rotate(-90 10 ${H / 2})">actual pass rate</text>
      </svg>
    `;
    document.getElementById("model-calibration").innerHTML = svg;
  }

  return { init };
})();
