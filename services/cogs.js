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

function normalizeOfferId(value) {
  return normalizeKey(value).toLowerCase();
}

function ensureFile(filePath) {
  const dir = require("path").dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function toArrayRow(row) {
  if (Array.isArray(row)) {
    return row;
  }

  return [
    row.sku || row.SKU,
    row.offerId || row["Offer ID"],
    row.productName || row["Product Name"],
    row.cogs || row.COGS,
    row.logisticsToMp || row["Logistics To MP"],
    row.notes || row.Notes
  ];
}

function parseCogsRows(rows) {
  return rows
    .map(row => {
      const values = toArrayRow(row);
      const offerId = normalizeKey(values[1]);

      return {
        sku: normalizeKey(values[0]),
        offerId,
        offerIdKey: normalizeOfferId(offerId),
        productName: normalizeKey(values[2]),
        cogs: toNumber(values[3]),
        logisticsToMp: toNumber(values[4]),
        notes: normalizeKey(values[5])
      };
    })
    .filter(item => item.sku || item.offerId);
}

function parseBulkImportText(text) {
  return parseCogsRows(
    String(text || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !/^(sku|offer|product|cogs|себес|name)/i.test(line))
      .map(line => {
        const normalizedLine = line.replace(/(\d+),(\d+)/g, "$1.$2");
        let parts = [];

        if (normalizedLine.includes("\t")) {
          parts = normalizedLine.split("\t");
        } else if (normalizedLine.includes(";")) {
          parts = normalizedLine.split(";");
        } else if (normalizedLine.includes(",")) {
          parts = normalizedLine.split(",");
        } else {
          parts = normalizedLine.split(/\s+/);
        }

        parts = parts.map(p => p.trim());

        if (parts.length >= 4) {
          return [
            parts[0] || "",
            parts[1] || "",
            parts[2] || "",
            parts[3] || "",
            parts[4] || "",
            parts[5] || ""
          ];
        }

        if (parts.length === 2) {
          const identifier = parts[0];
          const cogs = parts[1];
          const treatAsOfferId = /[^\d]/.test(identifier);
          if (treatAsOfferId) {
            return ["", identifier, "", cogs, "", ""];
          } else {
            return [identifier, "", "", cogs, "", ""];
          }
        }

        if (parts.length === 3) {
          const identifier = parts[0];
          const cogs = parts[1];
          const logisticsToMp = parts[2];
          const treatAsOfferId = /[^\d]/.test(identifier);
          if (treatAsOfferId) {
            return ["", identifier, "", cogs, logisticsToMp, ""];
          } else {
            return [identifier, "", "", cogs, logisticsToMp, ""];
          }
        }

        return null;
      })
      .filter(Boolean)
  );
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

  function writeItems(items) {
    writeStore({ items: parseCogsRows(items) });
  }

  function upsert(item) {
    const parsed = parseCogsRows([item])[0];
    if (!parsed) {
      throw new Error("COGS item is empty");
    }

    const items = list().filter(existing => {
      if (parsed.sku && existing.sku === parsed.sku) {
        return false;
      }
      if (parsed.offerIdKey && existing.offerIdKey === parsed.offerIdKey) {
        return false;
      }
      return true;
    });

    items.push(parsed);
    writeItems(items);
    return parsed.sku ? getCogsBySku(parsed.sku) : getCogsByOfferId(parsed.offerId);
  }

  function setSku(skuOrOfferId, cogs, extra = {}) {
    const identifier = normalizeKey(skuOrOfferId);
    if (!identifier) {
      throw new Error("SKU or Offer ID is required");
    }

    const treatAsOfferId = extra.useOfferId || /[^\d]/.test(identifier);
    return upsert({
      sku: treatAsOfferId ? normalizeKey(extra.sku) : identifier,
      offerId: treatAsOfferId ? identifier : normalizeKey(extra.offerId),
      productName: normalizeKey(extra.productName),
      cogs: toNumber(cogs),
      logisticsToMp: toNumber(extra.logisticsToMp),
      notes: normalizeKey(extra.notes)
    });
  }

  function resolveCogs(sku, offerId) {
    const items = list();
    const normalizedSku = sku ? String(sku).trim() : "";
    const normalizedOfferId = offerId ? String(offerId).trim() : "";

    if (normalizedSku) {
      const match = items.find(item => item.sku === normalizedSku);
      if (match) {
        return { match, source: "sku" };
      }
    }

    if (normalizedOfferId) {
      const matchExact = items.find(item => item.offerId === normalizedOfferId);
      if (matchExact) {
        return { match: matchExact, source: "offerId" };
      }

      const lowerOfferId = normalizedOfferId.toLowerCase();
      const matchCI = items.find(item => item.offerIdKey === lowerOfferId);
      if (matchCI) {
        return { match: matchCI, source: "offerId-case-insensitive" };
      }
    }

    return null;
  }

  function importText(text) {
    const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const parsed = parseBulkImportText(text);
    if (!parsed.length) {
      throw new Error("Не удалось распознать строки COGS для импорта.");
    }

    const items = list();
    for (const item of parsed) {
      const filtered = items.filter(existing => {
        if (item.sku && existing.sku === item.sku) {
          return false;
        }
        if (item.offerIdKey && existing.offerIdKey === item.offerIdKey) {
          return false;
        }
        return true;
      });
      filtered.push(item);
      items.length = 0;
      items.push(...filtered);
    }

    writeItems(items);
    return {
      imported: parsed.length,
      skipped: Math.max(0, lines.length - parsed.length),
      totalItems: list().length
    };
  }

  function clear() {
    writeStore({ items: [] });
    return { ok: true };
  }

  function getCogsBySku(sku) {
    const res = resolveCogs(sku, null);
    return res ? res.match : null;
  }

  function getCogsByOfferId(offerId) {
    const res = resolveCogs(null, offerId);
    return res ? res.match : null;
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
      const resolved = resolveCogs(row.sku, row.offerId);
      const cogsEntry = resolved ? resolved.match : null;
      if (!cogsEntry && (row.sku || row.offerId)) {
        missingSkus.add(String(row.sku || row.offerId));
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
    importText,
    list,
    mergeCogsIntoPerformanceRows,
    parseCogsRows,
    setSku,
    resolveCogs
  };
}

module.exports = {
  createCogsService,
  normalizeOfferId,
  parseBulkImportText,
  parseCogsRows
};
