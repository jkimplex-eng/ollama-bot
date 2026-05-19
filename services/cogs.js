const fs = require("fs");

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function normalizeKey(value) {
  return String(value || "").trim();
}

function ensureFile(filePath) {
  const dir = require("path").dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function parseCogsRows(rows) {
  return rows
    .map(row => {
      if (Array.isArray(row)) {
        return {
          sku: normalizeKey(row[0]),
          offerId: normalizeKey(row[1]),
          productName: normalizeKey(row[2]),
          cogs: toNumber(row[3]),
          logisticsToMp: toNumber(row[4]),
          notes: normalizeKey(row[5])
        };
      }

      return {
        sku: normalizeKey(row.sku || row.SKU),
        offerId: normalizeKey(row.offerId || row["Offer ID"]),
        productName: normalizeKey(row.productName || row["Product Name"]),
        cogs: toNumber(row.cogs || row.COGS),
        logisticsToMp: toNumber(row.logisticsToMp || row["Logistics To MP"]),
        notes: normalizeKey(row.notes || row.Notes)
      };
    })
    .filter(item => item.sku || item.offerId);
}

function createCogsService({ filePath }) {
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

  function list() {
    return parseCogsRows(readStore().items);
  }

  function setSku(sku, cogs, extra = {}) {
    const normalizedSku = normalizeKey(sku);
    if (!normalizedSku) {
      throw new Error("SKU is required");
    }

    const items = list().filter(item => item.sku !== normalizedSku);
    items.push({
      sku: normalizedSku,
      offerId: normalizeKey(extra.offerId),
      productName: normalizeKey(extra.productName),
      cogs: toNumber(cogs),
      logisticsToMp: toNumber(extra.logisticsToMp),
      notes: normalizeKey(extra.notes)
    });
    writeStore({ items });
    return getCogsBySku(normalizedSku);
  }

  function clear() {
    writeStore({ items: [] });
    return { ok: true };
  }

  function getCogsBySku(sku) {
    const normalizedSku = normalizeKey(sku);
    return list().find(item => item.sku === normalizedSku) || null;
  }

  function getCogsByOfferId(offerId) {
    const normalizedOfferId = normalizeKey(offerId);
    return list().find(item => item.offerId === normalizedOfferId) || null;
  }

  function getStatus() {
    const items = list();
    return {
      totalConfiguredSkus: items.filter(item => item.sku).length,
      totalItems: items.length
    };
  }

  function mergeCogsIntoPerformanceRows(rows) {
    const missingSkus = new Set();
    const mergedRows = rows.map(row => {
      const cogsEntry = getCogsBySku(row.sku) || getCogsByOfferId(row.offerId);
      if (!cogsEntry && row.sku) {
        missingSkus.add(String(row.sku));
      }

      return {
        ...row,
        cogs: cogsEntry ? toNumber(cogsEntry.cogs) : 0,
        logisticsToMp: cogsEntry ? toNumber(cogsEntry.logisticsToMp) : 0,
        cogsConfigured: Boolean(cogsEntry)
      };
    });

    return {
      rows: mergedRows,
      missingSkus: Array.from(missingSkus)
    };
  }

  return {
    clear,
    getCogsByOfferId,
    getCogsBySku,
    getStatus,
    list,
    mergeCogsIntoPerformanceRows,
    parseCogsRows,
    setSku
  };
}

module.exports = {
  createCogsService,
  parseCogsRows
};
