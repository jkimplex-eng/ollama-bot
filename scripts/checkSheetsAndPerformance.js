const assert = require("assert");
const { getSheetMapping } = require("../config/sheetsMap");
const { normalizeRows } = require("../services/sheets");
const { parsePerformanceCommand } = require("../services/telegram");

function run() {
  assert.strictEqual(getSheetMapping("performance_stats").logicalName, "performance_stats");

  assert.throws(() => getSheetMapping("missing_mapping"), /Unknown sheet mapping: missing_mapping/);

  assert.deepStrictEqual(normalizeRows([[1, 2]], 3), [[1, 2, ""]]);
  assert.throws(
    () => normalizeRows([[1, 2, 3, 4]], 3),
    /Row length validation failed/
  );

  assert.deepStrictEqual(parsePerformanceCommand("/performance campaigns"), {
    type: "campaigns"
  });

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats 2026-05-01 2026-05-14"),
    {
      type: "stats",
      toSheet: false,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  assert.deepStrictEqual(
    parsePerformanceCommand("/performance stats в таблицу 2026-05-01 2026-05-14"),
    {
      type: "stats",
      toSheet: true,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14"
    }
  );

  console.log("Sheets/performance checks passed");
}

run();
