// In-browser scorer for the exported XGBoost tree dump (docs/data/model.json).
// Mirrors nfl_predictor's Python training pipeline exactly: same feature
// order, same personnel one-hot encoding, same tree-traversal + sigmoid.
// (Validated against sklearn's predict_proba to within float32 precision.)

const NFLModel = (() => {
  let modelData = null;

  async function load() {
    if (modelData) return modelData;
    const res = await fetch("data/model.json");
    modelData = await res.json();
    return modelData;
  }

  function parsePersonnelGroup(raw) {
    if (!raw || typeof raw !== "string") return "UNK";
    let rb = "0";
    let te = "0";
    const re = /(\d+)\s*(RB|TE)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      if (m[2] === "RB") rb = m[1];
      if (m[2] === "TE") te = m[1];
    }
    return `${rb}${te}`;
  }

  // situation = { down, ydstogo, yardline_100, score_differential,
  //               game_seconds_remaining, qtr, personnel_group }
  function buildFeatureRow(situation) {
    const row = {
      down: situation.down,
      ydstogo: Math.min(situation.ydstogo, 30),
      yardline_100: situation.yardline_100,
      score_differential: situation.score_differential,
      game_seconds_remaining: situation.game_seconds_remaining,
      qtr: situation.qtr,
    };
    const group = modelData.personnel_categories.includes(situation.personnel_group)
      ? situation.personnel_group
      : "UNK";
    for (const cat of modelData.personnel_categories) {
      row[`personnel_${cat}`] = cat === group ? 1 : 0;
    }
    return row;
  }

  function scoreTree(node, row) {
    while (node.leaf === undefined) {
      const val = row[node.split];
      const cond = node.split_condition;
      let goId;
      if (val === undefined || val === null || Number.isNaN(val)) {
        goId = node.missing !== undefined ? node.missing : node.yes;
      } else {
        goId = val < cond ? node.yes : node.no;
      }
      node = node.children.find((c) => c.nodeid === goId);
    }
    return node.leaf;
  }

  // Returns P(pass) in [0, 1].
  function predictPassProbability(situation) {
    const row = buildFeatureRow(situation);
    const baseScore = modelData.base_score;
    let margin = Math.log(baseScore / (1 - baseScore));
    for (const tree of modelData.trees) {
      margin += scoreTree(tree, row);
    }
    return 1 / (1 + Math.exp(-margin));
  }

  function personnelCategories() {
    return modelData ? modelData.personnel_categories : [];
  }

  return { load, parsePersonnelGroup, predictPassProbability, personnelCategories };
})();
