const fs = require("fs");
const path = require("path");
const { normalizeMonth } = require("./prioritySkus");

function ensureFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeItem(item) {
  return {
    month: normalizeMonth(item.month),
    budget: Math.max(0, toNumber(item.budget, 0)),
    coefficient: Math.max(0, toNumber(item.coefficient, 2) || 2),
    targetCity: String(item.targetCity || "Москва").trim() || "Москва",
    notes: String(item.notes || "").trim()
  };
}

function createExternalTrafficPlanService({ filePath }) {
  ensureFile(filePath);

  function readStore() {
    ensureFile(filePath);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(raw.items) ? raw : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  function writeStore(store) {
    ensureFile(filePath);
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  }

  function setPlan({ month, budget, coefficient = 2, city = "Москва", notes = "" }) {
    const next = normalizeItem({
      month,
      budget,
      coefficient,
      targetCity: city,
      notes
    });
    const items = readStore().items
      .map(normalizeItem)
      .filter(item => item.month !== next.month);
    items.push(next);
    writeStore({ items });
    return next;
  }

  function getPlan(month) {
    const normalizedMonth = normalizeMonth(month);
    return readStore().items.map(normalizeItem).find(item => item.month === normalizedMonth) || null;
  }

  function clear(month) {
    const normalizedMonth = normalizeMonth(month);
    const items = readStore().items.map(normalizeItem).filter(item => item.month !== normalizedMonth);
    writeStore({ items });
    return { ok: true };
  }

  return {
    clear,
    getPlan,
    setPlan
  };
}

module.exports = {
  createExternalTrafficPlanService
};
