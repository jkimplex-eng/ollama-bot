const fs = require("fs");
const path = require("path");

function ensureFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function normalizeMonth(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error("Month must be in YYYY-MM format");
  }
  return `${match[1]}-${match[2]}`;
}

function normalizeOfferId(value) {
  return String(value || "").trim();
}

function normalizeOfferIdKey(value) {
  return normalizeOfferId(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeItem(item) {
  const month = normalizeMonth(item.month);
  const offerId = normalizeOfferId(item.offerId);
  if (!offerId) {
    throw new Error("Offer ID is required for priority SKU");
  }
  return {
    month,
    offerId,
    offerIdKey: normalizeOfferIdKey(offerId),
    sku: String(item.sku || "").trim(),
    productName: String(item.productName || "").trim(),
    priority: String(item.priority || "HIGH").trim() || "HIGH",
    weight: Math.max(0, toNumber(item.weight, 1) || 1),
    targetCity: String(item.targetCity || "Москва").trim() || "Москва",
    notes: String(item.notes || "").trim()
  };
}

function createPrioritySkusService({ filePath }) {
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

  function list(month) {
    const items = readStore().items.map(normalizeItem);
    if (!month) {
      return items;
    }
    const normalizedMonth = normalizeMonth(month);
    return items.filter(item => item.month === normalizedMonth);
  }

  function addOrUpdate({ month, offerId, weight = 1, city = "Москва", sku = "", productName = "", notes = "" }) {
    const next = normalizeItem({
      month,
      offerId,
      weight,
      targetCity: city,
      sku,
      productName,
      notes
    });
    const items = readStore().items
      .map(normalizeItem)
      .filter(item => !(item.month === next.month && item.offerIdKey === next.offerIdKey));
    items.push(next);
    writeStore({ items });
    return next;
  }

  function clear(month) {
    const normalizedMonth = normalizeMonth(month);
    const items = readStore().items.map(normalizeItem).filter(item => item.month !== normalizedMonth);
    writeStore({ items });
    return { ok: true };
  }

  function find(month, offerId) {
    const normalizedMonth = normalizeMonth(month);
    const offerIdKey = normalizeOfferIdKey(offerId);
    return list(normalizedMonth).find(item => item.offerIdKey === offerIdKey) || null;
  }

  return {
    addOrUpdate,
    clear,
    find,
    list,
    normalizeMonth
  };
}

module.exports = {
  createPrioritySkusService,
  normalizeMonth
};
