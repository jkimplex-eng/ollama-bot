const fs = require("fs");
const path = require("path");

function ensureFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function formatDate(value) {
  const normalized = String(value || "").trim();
  const ruMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ruMatch) {
    return ruMatch[3] + "-" + ruMatch[2] + "-" + ruMatch[1];
  }
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function normalizeFinanceRow(row) {
  return {
    date: formatDate(row.date),
    sales: toNumber(row.sales),
    returns: toNumber(row.returns),
    ozonCommission: toNumber(row.ozonCommission),
    logistics: toNumber(row.logistics),
    partnerServices: toNumber(row.partnerServices),
    fboServices: toNumber(row.fboServices),
    advertising: toNumber(row.advertising),
    otherServices: toNumber(row.otherServices),
    accruedTotal: toNumber(row.accruedTotal)
  };
}

function createFinanceFactsService({ filePath }) {
  ensureFile(filePath);

  function readStore() {
    ensureFile(filePath);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(data.items) ? data : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  function writeStore(store) {
    ensureFile(filePath);
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  }

  function saveFinanceRows(rows, metadata = {}) {
    const normalizedRows = rows.map(normalizeFinanceRow);
    const store = readStore();
    const map = new Map(
      store.items.map(item => [
        formatDate(item.date),
        item
      ])
    );

    for (const row of normalizedRows) {
      map.set(row.date, {
        ...row,
        metadata: {
          dateFrom: metadata.dateFrom || row.date,
          dateTo: metadata.dateTo || row.date,
          savedAt: metadata.savedAt || new Date().toISOString(),
          source: metadata.source || "manual"
        }
      });
    }

    const items = Array.from(map.values()).sort((left, right) => left.date.localeCompare(right.date));
    writeStore({ items });
    return { totalStoredRows: items.length, rowsSaved: normalizedRows.length };
  }

  function getFinanceRowsForDateRange(dateFrom, dateTo) {
    const from = formatDate(dateFrom);
    const to = formatDate(dateTo);
    return readStore().items
      .map(normalizeFinanceRow)
      .filter(item => item.date >= from && item.date <= to);
  }

  function getFinanceRowsStatus() {
    const items = readStore().items.map(normalizeFinanceRow);
    if (!items.length) {
      return { totalStoredRows: 0, minDate: "", maxDate: "" };
    }
    const dates = items.map(item => item.date).sort();
    return {
      totalStoredRows: items.length,
      minDate: dates[0],
      maxDate: dates[dates.length - 1]
    };
  }

  function clearFinanceRows() {
    writeStore({ items: [] });
    return { ok: true };
  }

  function importSample() {
    return saveFinanceRows(
      [
        {
          date: "2026-05-14",
          sales: 396053,
          returns: -10173,
          ozonCommission: -158211,
          logistics: -14147,
          partnerServices: -3742,
          fboServices: -1625,
          advertising: -39695,
          otherServices: 0,
          accruedTotal: 166855
        }
      ],
      {
        dateFrom: "2026-05-14",
        dateTo: "2026-05-14",
        source: "sample"
      }
    );
  }

  return {
    clearFinanceRows,
    getFinanceRowsForDateRange,
    getFinanceRowsStatus,
    importSample,
    normalizeFinanceRow,
    saveFinanceRows
  };
}

module.exports = {
  createFinanceFactsService
};
