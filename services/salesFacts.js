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

function normalizeSalesRow(row) {
  return {
    date: formatDate(row.date),
    sku: String(row.sku || ""),
    offerId: String(row.offerId || ""),
    productName: String(row.productName || ""),
    quantity: toNumber(row.quantity),
    revenue: toNumber(row.revenue),
    price: row.price === "" ? "" : toNumber(row.price),
    postingNumber: String(row.postingNumber || ""),
    orderId: String(row.orderId || ""),
    status: String(row.status || "")
  };
}

function createSalesFactsService({ filePath }) {
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

  function saveSalesRows(rows, metadata = {}) {
    const normalizedRows = rows.map(normalizeSalesRow);
    const store = readStore();
    const map = new Map(
      store.items.map(item => [
        [formatDate(item.date), item.sku || "", item.postingNumber || item.orderId || "", item.quantity, item.revenue].join("|"),
        item
      ])
    );

    for (const row of normalizedRows) {
      const key = [row.date, row.sku || "", row.postingNumber || row.orderId || "", row.quantity, row.revenue].join("|");
      map.set(key, {
        ...row,
        metadata: {
          dateFrom: metadata.dateFrom || "",
          dateTo: metadata.dateTo || "",
          savedAt: metadata.savedAt || new Date().toISOString()
        }
      });
    }

    const items = Array.from(map.values());
    writeStore({ items });
    return { totalStoredRows: items.length, rowsSaved: normalizedRows.length };
  }

  function getSalesRowsForDateRange(dateFrom, dateTo) {
    const from = formatDate(dateFrom);
    const to = formatDate(dateTo);
    return readStore().items
      .map(normalizeSalesRow)
      .filter(item => item.date >= from && item.date <= to);
  }

  function getSalesRowsStatus() {
    const items = readStore().items.map(normalizeSalesRow);
    if (!items.length) {
      return { totalStoredRows: 0, minDate: "", maxDate: "", uniqueSkus: 0 };
    }
    const dates = items.map(item => item.date).sort();
    return {
      totalStoredRows: items.length,
      minDate: dates[0],
      maxDate: dates[dates.length - 1],
      uniqueSkus: new Set(items.map(item => item.sku).filter(Boolean)).size
    };
  }

  function clearSalesRows() {
    writeStore({ items: [] });
    return { ok: true };
  }

  function aggregateSalesByDate(rows) {
    const map = new Map();
    for (const row of rows.map(normalizeSalesRow)) {
      const current = map.get(row.date) || { date: row.date, quantity: 0, revenue: 0, orders: 0 };
      current.quantity += row.quantity;
      current.revenue += row.revenue;
      current.orders += row.postingNumber || row.orderId ? 1 : row.quantity;
      map.set(row.date, current);
    }
    return Array.from(map.values());
  }

  function aggregateSalesBySku(rows) {
    const map = new Map();
    for (const row of rows.map(normalizeSalesRow)) {
      const key = row.sku || row.offerId || "";
      const current = map.get(key) || {
        sku: row.sku,
        offerId: row.offerId,
        productName: row.productName,
        quantity: 0,
        revenue: 0
      };
      current.quantity += row.quantity;
      current.revenue += row.revenue;
      map.set(key, current);
    }
    return Array.from(map.values());
  }

  return {
    aggregateSalesByDate,
    aggregateSalesBySku,
    clearSalesRows,
    getSalesRowsForDateRange,
    getSalesRowsStatus,
    saveSalesRows
  };
}

module.exports = {
  createSalesFactsService
};
