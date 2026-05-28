const fs = require("fs");
const path = require("path");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureState(filePath) {
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ items: [] }, null, 2));
  }
}

function createWarehouseMappingService({ filePath }) {
  function readState() {
    ensureState(filePath);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(parsed?.items) ? parsed : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  function writeState(state) {
    ensureState(filePath);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  function setMapping(warehouseNameOrId, city, cluster, leadTimeDays) {
    const input = normalizeText(warehouseNameOrId);
    if (!input) {
      throw new Error("warehouseNameOrId is required");
    }

    const state = readState();
    const item = {
      warehouseKey: normalizeKey(input),
      warehouseId: /^\d+$/.test(input) ? input : "",
      warehouseName: /^\d+$/.test(input) ? "" : input,
      city: normalizeText(city) || "unknown",
      cluster: normalizeText(cluster) || "unknown",
      leadTimeDays: Math.max(0, toNumber(leadTimeDays, 0))
    };

    const index = state.items.findIndex(existing => existing.warehouseKey === item.warehouseKey);
    if (index >= 0) {
      state.items[index] = { ...state.items[index], ...item };
    } else {
      state.items.push(item);
    }

    writeState(state);
    return index >= 0 ? state.items[index] : item;
  }

  function listMappings() {
    return readState().items.slice().sort((a, b) => {
      const left = a.warehouseName || a.warehouseId || "";
      const right = b.warehouseName || b.warehouseId || "";
      return left.localeCompare(right);
    });
  }

  function clearMappings() {
    writeState({ items: [] });
  }

  function resolveMapping({ warehouseId, warehouseName }) {
    const items = readState().items;
    const idKey = normalizeKey(warehouseId);
    const nameKey = normalizeKey(warehouseName);

    if (idKey) {
      const byId = items.find(item => item.warehouseId && normalizeKey(item.warehouseId) === idKey);
      if (byId) {
        return byId;
      }
    }

    if (nameKey) {
      const byName = items.find(item => item.warehouseName && normalizeKey(item.warehouseName) === nameKey);
      if (byName) {
        return byName;
      }
    }

    return null;
  }

  return {
    clearMappings,
    listMappings,
    resolveMapping,
    setMapping
  };
}

module.exports = {
  createWarehouseMappingService,
  normalizeKey
};
