const fs = require("fs");
const path = require("path");

const MAX_CAMPAIGNS_PER_REQUEST = 10;
const ACTIVE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const REPORT_POLL_MIN_INTERVAL_MS = 20 * 1000;

function createUnavailableError(message) {
  const error = new Error(message);
  error.code = "PERFORMANCE_UNAVAILABLE";
  return error;
}

function createPendingReportError(uuid, message = "") {
  const error = new Error(message || "Performance report is pending.");
  error.code = "PERFORMANCE_REPORT_PENDING";
  error.uuid = uuid;
  return error;
}

function createActiveLimitError(message = "") {
  const error = new Error(message || "Performance active report limit reached.");
  error.code = "PERFORMANCE_ACTIVE_LIMIT";
  return error;
}

function createCooldownError(until, message = "") {
  const error = new Error(message || "Performance active limit cooldown in effect.");
  error.code = "PERFORMANCE_COOLDOWN";
  error.until = until;
  return error;
}

function createPollThrottleError(uuid, nextAllowedAt, message = "") {
  const error = new Error(message || "Performance report polling is throttled.");
  error.code = "PERFORMANCE_REPORT_POLL_THROTTLED";
  error.uuid = uuid;
  error.nextAllowedAt = nextAllowedAt;
  return error;
}

function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const normalized = String(value).trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
  }

  const ruMatch = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ruMatch) {
    return ruMatch[3] + "-" + ruMatch[2] + "-" + ruMatch[1];
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return normalized.slice(0, 10);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function createRequestGroupId() {
  return "perf-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function createRecoveredGroupId(uuid) {
  return "recovered-" + String(uuid || "").toLowerCase();
}

function formatClockTime(value) {
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return hours + ":" + minutes;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseSemicolonCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ";" && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(current.trim());
      if (row.some(cell => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current.trim());
    if (row.some(cell => cell !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeCsvHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function logNormalizedCsvHeadersOnce(logger, headers) {
  if (!logger || logger.__performanceCsvHeadersLogged) {
    return;
  }

  logger.__performanceCsvHeadersLogged = true;
  logger.log("[performance] normalized csv headers", {
    headers
  });
}

function normalizeCampaign(item) {
  const dailyBudget = toNumber(item.dailyBudget);
  const budget = toNumber(item.budget);
  const weeklyBudget = toNumber(item.weeklyBudget);
  const advObjectType = item.advObjectType ?? item.adv_object_type ?? "";
  const rawPaymentType = item.paymentType ?? "";
  const placementValues = Array.isArray(item.placement)
    ? item.placement.filter(Boolean)
    : item.placement
      ? [item.placement]
      : [];
  const placement = placementValues.join(", ");

  return {
    campaignId: String(item.id ?? ""),
    campaignName: item.title ?? "",
    status: item.state ?? "",
    advObjectType,
    paymentType: inferPaymentType({
      advObjectType,
      paymentType: rawPaymentType,
      placementValues
    }),
    rawPaymentType,
    fromDate: item.fromDate ?? "",
    toDate: item.toDate ?? "",
    budget: budget === null ? "" : budget / 1_000_000,
    dailyBudget: dailyBudget === null ? "" : dailyBudget / 1_000_000,
    weeklyBudget: weeklyBudget === null ? "" : weeklyBudget / 1_000_000,
    placement,
    productCampaignMode: item.productCampaignMode ?? item.productAutopilotStrategy ?? "",
    createdAt: item.createdAt ?? "",
    updatedAt: item.updatedAt ?? ""
  };
}

function inferPaymentType({ advObjectType, paymentType, placementValues }) {
  if (paymentType) {
    return paymentType;
  }

  if (advObjectType === "SEARCH_PROMO" || advObjectType === "ALL_SKU_PROMO") {
    return "CPO / Оплата за заказ";
  }

  if (advObjectType === "SKU") {
    if (placementValues.includes("PLACEMENT_TOP_PROMOTION")) {
      return "CPC_TOP / Поиск";
    }

    if (placementValues.includes("PLACEMENT_SEARCH_AND_CATEGORY")) {
      return "CPC / Поиск и рекомендации";
    }

    if (placementValues.includes("PLACEMENT_OVERTOP")) {
      return "CPC / Спецразмещение";
    }

    return "SKU / unknown payment";
  }

  return "";
}

function formatBudgetValue(value) {
  const number = toNumber(value);
  if (number === null) return "";
  return Number(number.toFixed(2));
}

function inferRemoteReportStatus(item) {
  const meta = item?.meta || {};

  if (meta.error) {
    return "failed";
  }

  if (meta.link) {
    return "ready";
  }

  if (!Object.keys(meta).length && !item?.status && !item?.state) {
    return "unknown";
  }

  if (item?.status || item?.state) {
    return String(item.status || item.state || "").toLowerCase();
  }

  return "pending";
}

function normalizeRemoteReport(item) {
  const meta = item?.meta || {};
  const uuid = meta.UUID || item?.UUID || item?.uuid || "";
  const status = inferRemoteReportStatus(item);

  return {
    uuid: uuid || "-",
    status,
    createdAt:
      meta.createdAt ||
      meta.createTime ||
      meta.created ||
      item?.createdAt ||
      item?.createTime ||
      "",
    dateFrom: meta.dateFrom || item?.dateFrom || "",
    dateTo: meta.dateTo || item?.dateTo || "",
    reportType: meta.reportType || item?.reportType || meta.groupBy || item?.groupBy || "",
    item
  };
}

function extractCampaignMeta(headerText) {
  const text = String(headerText || "");
  const idMatch = text.match(/№\s*(\d+)/);
  const nameMatch = text.match(/;\s*(.+?),\s*период/i);

  return {
    campaignId: idMatch ? idMatch[1] : "",
    campaignName: nameMatch ? nameMatch[1].trim() : ""
  };
}

function getCell(row, indexMap, key) {
  const index = indexMap.get(normalizeCsvHeader(key));
  if (index === undefined) return "";
  return row[index] ?? "";
}

function getCellByAliases(row, indexMap, keys) {
  for (const key of keys) {
    const value = getCell(row, indexMap, key);
    if (value !== "") {
      return value;
    }
  }

  return "";
}

function normalizeStatsFromCsv(csvText, options = {}) {
  const rows = parseSemicolonCsv(csvText);
  const result = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].map(normalizeCsvHeader);
    const hasHeader = row.includes("sku") || row.includes("SKU");

    if (!hasHeader) {
      continue;
    }

    const meta = extractCampaignMeta((rows[index - 1] || []).join(" "));
    const headers = row.map(normalizeCsvHeader);
    const indexMap = new Map(headers.map((header, headerIndex) => [header, headerIndex]));
    const dateHeader = headers.find(header => header === "День" || header.includes("Дата"));

    logNormalizedCsvHeadersOnce(options.logger, headers);

    for (let dataIndex = index + 1; dataIndex < rows.length; dataIndex += 1) {
      const dataRow = rows[dataIndex];
      const normalizedDataRow = dataRow.map(normalizeCsvHeader);
      const nextHeader = normalizedDataRow.includes("sku") || normalizedDataRow.includes("SKU");

      if (nextHeader) {
        index = dataIndex - 1;
        break;
      }

      if (!dataRow.length || !getCell(dataRow, indexMap, "sku")) {
        continue;
      }

      result.push({
        date: dateHeader ? getCell(dataRow, indexMap, dateHeader) : "",
        campaignId: meta.campaignId,
        campaignName: meta.campaignName,
        sku: getCellByAliases(dataRow, indexMap, ["sku", "SKU"]),
        productName: getCellByAliases(dataRow, indexMap, ["Название товара"]),
        price: toNumber(getCellByAliases(dataRow, indexMap, ["Цена товара, ₽", "Цена товара, Р"])),
        impressions: toNumber(getCellByAliases(dataRow, indexMap, ["Показы"])),
        clicks: toNumber(getCellByAliases(dataRow, indexMap, ["Клики"])),
        ctr: toNumber(getCellByAliases(dataRow, indexMap, ["CTR (%)"])),
        addToCart: toNumber(getCellByAliases(dataRow, indexMap, ["В корзину"])),
        avgCpc: toNumber(
          getCellByAliases(dataRow, indexMap, [
            "Средняя стоимость клика, ₽",
            "Средняя стоимость клика, руб.",
            "Ср. цена клика, г"
          ])
        ),
        avgCpm: toNumber(
          getCellByAliases(dataRow, indexMap, ["Средняя стоимость 1000 показов, ₽", "Ср. цена 1000 показов, Р"])
        ),
        spend: toNumber(
          getCellByAliases(dataRow, indexMap, [
            "Расход, ₽, с НДС",
            "Расход, ₽ с НДС",
            "Расход, Р, с НДС"
          ])
        ),
        orders: toNumber(getCellByAliases(dataRow, indexMap, ["Заказы"])),
        revenue: toNumber(
          getCellByAliases(dataRow, indexMap, [
            "Продажи, ₽",
            "Продажи, руб.",
            "Заказано на сумму, ₽",
            "Выручка, Р"
          ])
        ),
        modelOrders: toNumber(getCellByAliases(dataRow, indexMap, ["Заказы модели"])),
        modelRevenue: toNumber(
          getCellByAliases(dataRow, indexMap, [
            "Продажи с заказов модели, ₽",
            "Продажи с заказов модели, руб.",
            "Выручка с заказов модели, Р"
          ])
        ),
        drr: toNumber(
          getCellByAliases(dataRow, indexMap, ["ДРР, %", "ДРР, %: Дата добавления"])
        ),
        orderedAmount: toNumber(getCellByAliases(dataRow, indexMap, ["Заказано на сумму, ₽"])),
        totalDrr: toNumber(getCellByAliases(dataRow, indexMap, ["Общий ДРР"])),
        addedAt: getCellByAliases(dataRow, indexMap, ["Дата добавления"])
      });
    }
  }

  if (!result.length) {
    throw new Error("Performance API returned unexpected report shape.");
  }

  return result;
}

function looksLikeCsvReportBody(text) {
  const normalized = normalizeCsvHeader(text);

  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith(";") ||
    normalized.includes(";sku;") ||
    normalized.includes(";SKU;") ||
    normalized.includes("Показы") ||
    normalized.includes("Выручка, Р") ||
    normalized.includes("Продажи, ₽") ||
    normalized.includes("Расход, ₽, с НДС")
  );
}

function parseCsvReadyResponse({ ok, status, contentType, bodyText }, options = {}) {
  const type = String(contentType || "").toLowerCase();
  const body = String(bodyText || "");

  if (!ok || status !== 200) {
    return null;
  }

  if (!type.includes("text/csv") && !looksLikeCsvReportBody(body)) {
    return null;
  }

  const rows = normalizeStatsFromCsv(body, options);

  return {
    rows,
    rowsCount: rows.length
  };
}

function createPerformanceService({
  baseUrl,
  clientId,
  clientSecret,
  queueFile,
  reportsFile,
  rowsFile,
  sheetsService,
  logger = console
}) {
  let tokenCache = null;

  function isConfigured() {
    return Boolean(clientId && clientSecret);
  }

  function assertConfigured() {
    if (!isConfigured()) {
      throw createUnavailableError(
        "Performance API не настроен: проверь OZON_PERFORMANCE_CLIENT_ID и OZON_PERFORMANCE_CLIENT_SECRET."
      );
    }
  }

  function loadJsonData(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  function saveJsonData(filePath, value) {
    if (!filePath) return;
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  function loadReports() {
    const data = loadJsonData(reportsFile);
    return Array.isArray(data) ? data : [];
  }

  function saveReports(records) {
    saveJsonData(reportsFile, records);
  }

  function loadStoredRows() {
    const data = loadJsonData(rowsFile);
    return Array.isArray(data) ? data : [];
  }

  function saveStoredRows(records) {
    saveJsonData(rowsFile, records);
  }

  function upsertReportRecord(record) {
    const reports = loadReports();
    const index = reports.findIndex(item => item.uuid === record.uuid);
    const next = {
      ...record,
      updatedAt: new Date().toISOString()
    };

    if (index >= 0) {
      reports[index] = {
        ...reports[index],
        ...next
      };
    } else {
      reports.push({
        createdAt: new Date().toISOString(),
        ...next
      });
    }

    saveReports(reports);
    return reports.find(item => item.uuid === record.uuid);
  }

  function loadQueueState() {
    const data = loadJsonData(queueFile);

    if (Array.isArray(data)) {
      return {
        items: data,
        meta: {}
      };
    }

    if (data && typeof data === "object") {
      return {
        items: Array.isArray(data.items) ? data.items : [],
        meta: data.meta && typeof data.meta === "object" ? data.meta : {}
      };
    }

    return {
      items: [],
      meta: {}
    };
  }

  function saveQueueState(state) {
    saveJsonData(queueFile, {
      items: Array.isArray(state.items) ? state.items : [],
      meta: state.meta && typeof state.meta === "object" ? state.meta : {}
    });
  }

  function loadQueue() {
    return loadQueueState().items;
  }

  function saveQueue(items) {
    const state = loadQueueState();
    state.items = items;
    saveQueueState(state);
  }

  function getQueueMeta() {
    return loadQueueState().meta;
  }

  function updateQueueMeta(patch) {
    const state = loadQueueState();
    state.meta = {
      ...state.meta,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    saveQueueState(state);
    return state.meta;
  }

  function setActiveLimitTimestamp(timestamp = new Date().toISOString()) {
    return updateQueueMeta({
      lastActiveLimitAt: timestamp
    });
  }

  function getActiveLimitCooldownUntil() {
    const meta = getQueueMeta();
    if (!meta.lastActiveLimitAt) {
      return null;
    }

    const until = new Date(meta.lastActiveLimitAt).getTime() + ACTIVE_LIMIT_COOLDOWN_MS;
    return Number.isFinite(until) ? new Date(until).toISOString() : null;
  }

  function isActiveLimitCooldown() {
    const until = getActiveLimitCooldownUntil();
    if (!until) {
      return null;
    }

    if (new Date(until).getTime() > Date.now()) {
      return until;
    }

    return null;
  }

  function clearActiveLimitTimestamp() {
    const state = loadQueueState();
    if (!state.meta.lastActiveLimitAt) {
      return state.meta;
    }

    delete state.meta.lastActiveLimitAt;
    state.meta.updatedAt = new Date().toISOString();
    saveQueueState(state);
    return state.meta;
  }

  function resetQueue() {
    const state = loadQueueState();
    state.items = [];
    saveQueueState(state);
    return { ok: true };
  }

  function updateQueueItem(matcher, patch) {
    const queue = loadQueue();
    const index = queue.findIndex(matcher);

    if (index === -1) {
      return null;
    }

    queue[index] = {
      ...queue[index],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    saveQueue(queue);
    return queue[index];
  }

  function listQueue() {
    return loadQueue().sort((left, right) => {
      if (left.requestGroupId === right.requestGroupId) {
        return left.chunkIndex - right.chunkIndex;
      }

      return String(left.createdAt).localeCompare(String(right.createdAt));
    });
  }

  function getCurrentPendingQueueItem() {
    return listQueue().find(item => item.status === "pending") || null;
  }

  function getNextQueuedItem() {
    return listQueue().find(item => item.status === "queued") || null;
  }

  async function safeJson(response, fallback = {}) {
    try {
      return await response.json();
    } catch {
      return fallback;
    }
  }

  async function getPerformanceToken() {
    assertConfigured();

    if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
      return tokenCache.accessToken;
    }

    const response = await fetch(baseUrl + "/api/client/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      })
    });

    const data = await safeJson(response);

    if (!response.ok || !data.access_token) {
      logger.error("[performance] token request failed", {
        status: response.status
      });
      throw new Error(
        "Не удалось получить токен Performance API. Проверь client id, client secret и доступ к Ozon Performance."
      );
    }

    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 1800) * 1000
    };

    return tokenCache.accessToken;
  }

  async function requestJson(endpoint, options = {}) {
    assertConfigured();
    const token = await getPerformanceToken();
    const method = options.method || "GET";
    const url = new URL(baseUrl + endpoint);

    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": "Bearer " + token
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await safeJson(response);

    if (!response.ok) {
      const message =
        data.message ||
        data.error_description ||
        data.error ||
        "Performance API returned " + response.status;

      if (String(message).toLowerCase().includes("максимум 1")) {
        throw createActiveLimitError(message);
      }

      throw new Error(message);
    }

    return data;
  }

  async function requestReportDownload(uuid) {
    const response = await requestReportEndpoint(uuid);

    if (!response.ok) {
      throw new Error(
        response.bodyText || "Performance API report download failed: " + response.status
      );
    }

    if (response.contentType.includes("application/zip")) {
      throw new Error(
        "Performance API returned ZIP report. Current implementation expects CSV report."
      );
    }

    if (
      !response.contentType.includes("csv") &&
      !response.contentType.includes("text/plain") &&
      !looksLikeCsvReportBody(response.bodyText)
    ) {
      throw new Error(
        "Performance API returned unexpected report content type: " + response.contentType
      );
    }

    return response.bodyText;
  }

  async function requestReportEndpoint(uuid) {
    const token = await getPerformanceToken();
    const url = new URL(baseUrl + "/api/client/statistics/report");
    url.searchParams.set("UUID", uuid);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "*/*",
        "Authorization": "Bearer " + token
      }
    });

    let bodyText = "";

    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bodyText
    };
  }

  async function requestReportDownloadStatus(uuid) {
    const response = await requestReportEndpoint(uuid);

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.contentType,
      bodyPreview: response.bodyText.slice(0, 500)
    };
  }

  async function getCampaigns({ state, advObjectType, campaignIds, pageSize = 100 } = {}) {
    if (!isConfigured()) return [];
    const campaigns = [];
    let page = 1;

    while (true) {
      const query = {
        page,
        pageSize
      };

      if (Array.isArray(campaignIds) && campaignIds.length) {
        query.campaignIds = campaignIds.join(",");
      }

      if (state) {
        query.state = state;
      }

      if (advObjectType) {
        query.advObjectType = advObjectType;
      }

      const data = await requestJson("/api/client/campaign", {
        method: "GET",
        query
      });
      const items = data.list;

      if (!Array.isArray(items)) {
        throw new Error("Performance API returned unexpected campaigns shape.");
      }

      campaigns.push(...items.map(normalizeCampaign));

      if (!items.length || items.length < pageSize) {
        break;
      }

      page += 1;
    }

    return campaigns;
  }

  async function getCampaignObjects(campaignId) {
    const data = await requestJson("/api/client/campaign/" + campaignId + "/objects", {
      method: "GET"
    });

    if (!Array.isArray(data.list) && !Array.isArray(data.items) && !Array.isArray(data.result)) {
      throw new Error("Performance API returned unexpected campaign objects shape.");
    }

    return data.list || data.items || data.result;
  }

  async function getBidLimits() {
    const data = await requestJson("/api/client/limits/list", {
      method: "GET"
    });

    if (!Array.isArray(data.limits) && !Array.isArray(data.list) && !Array.isArray(data.items) && !Array.isArray(data.result)) {
      throw new Error("Performance API returned unexpected limits shape.");
    }

    return data.limits || data.list || data.items || data.result;
  }

  async function getMinBidBySku(sku) {
    const data = await requestJson("/api/client/min/sku", {
      method: "POST",
      body: {
        marketplaceId: "MARKETPLACE_ID_RU",
        paymentType: "CPC",
        sku: [String(sku)]
      }
    });

    return data;
  }

  async function createStatisticsReportRequest({
    campaignIds,
    dateFrom,
    dateTo,
    reportType = "stats",
    requestGroupId = "",
    chunkIndex = 0,
    totalChunks = 1,
    activeOnly = false
  }) {
    if (campaignIds.length > MAX_CAMPAIGNS_PER_REQUEST) {
      throw new Error(
        "Performance statistics request cannot contain more than " +
          MAX_CAMPAIGNS_PER_REQUEST +
          " campaigns."
      );
    }

    const data = await requestJson("/api/client/statistics", {
      method: "POST",
      body: {
        campaigns: campaignIds,
        dateFrom: formatDate(dateFrom),
        dateTo: formatDate(dateTo),
        groupBy: "DATE"
      }
    });

    if (!data.UUID) {
      throw new Error("Performance API did not return UUID for statistics request.");
    }

    const record = upsertReportRecord({
      uuid: data.UUID,
      dateFrom: formatDate(dateFrom),
      dateTo: formatDate(dateTo),
      reportType,
      requestGroupId,
      chunkIndex,
      totalChunks,
      campaignIds,
      activeOnly,
      status: "pending"
    });

    return record;
  }

  async function createSingleCampaignStatsReport({ campaignId, dateFrom, dateTo, reportType = "stats_single" }) {
    const cooldownUntil = isActiveLimitCooldown();

    if (cooldownUntil) {
      throw createCooldownError(
        cooldownUntil,
        "Ждём освобождения лимита Ozon до " +
          formatClockTime(cooldownUntil) +
          ". Используй /performance discover raw для диагностики."
      );
    }

    try {
      return await createStatisticsReportRequest({
        campaignIds: [String(campaignId)],
        dateFrom,
        dateTo,
        reportType,
        requestGroupId: createRequestGroupId(),
        chunkIndex: 1,
        totalChunks: 1,
        activeOnly: false
      });
    } catch (error) {
      if (error.code === "PERFORMANCE_ACTIVE_LIMIT") {
        setActiveLimitTimestamp();
      }

      throw error;
    }
  }

  async function createTestStatsReport({ dateFrom, dateTo }) {
    const campaigns = await getCampaigns({ state: "CAMPAIGN_STATE_RUNNING" });
    const first = campaigns[0];

    if (!first) {
      throw new Error("Не найдена ни одна активная кампания для test-запроса.");
    }

    const report = await createSingleCampaignStatsReport({
      campaignId: first.campaignId,
      dateFrom,
      dateTo,
      reportType: "stats_test"
    });

    return {
      campaign: first,
      report
    };
  }

  async function getStatisticsList(page = 1, pageSize = 100) {
    const data = await requestJson("/api/client/statistics/list", {
      method: "GET",
      query: {
        page,
        pageSize
      }
    });

    if (!Array.isArray(data.items)) {
      throw new Error("Performance API returned unexpected statistics list shape.");
    }

    return data.items;
  }

  async function getStatisticsListRaw(page = 1, pageSize = 100) {
    return requestJson("/api/client/statistics/list", {
      method: "GET",
      query: {
        page,
        pageSize
      }
    });
  }

  async function getAllStatisticsList(pageSize = 100) {
    const items = [];
    let page = 1;

    while (true) {
      const batch = await getStatisticsList(page, pageSize);
      items.push(...batch);

      if (!batch.length || batch.length < pageSize) {
        break;
      }

      page += 1;
    }

    return items;
  }

  async function discoverRemoteReports(limit = 10) {
    const items = await getAllStatisticsList(100);

    return items
      .map(normalizeRemoteReport)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, limit);
  }

  function hasQueueItemForUuid(uuid) {
    return listQueue().some(item => item.uuid === uuid);
  }

  function recoverQueueFromRemoteReport(report) {
    const existing = listQueue().find(item => item.uuid === report.uuid && report.uuid !== "-");

    if (existing) {
      return existing;
    }

    const queueItem = {
      requestGroupId: createRecoveredGroupId(report.uuid),
      chunkIndex: 1,
      totalChunks: 1,
      campaignIds: [],
      dateFrom: formatDate(report.dateFrom || report.createdAt),
      dateTo: formatDate(report.dateTo || report.createdAt),
      activeOnly: false,
      toSheet: false,
      status: report.status === "ready" ? "ready" : report.status === "failed" ? "failed" : report.status === "unknown" ? "pending" : "pending",
      uuid: report.uuid === "-" ? "" : report.uuid,
      recovered: true,
      reportType: report.reportType || "stats",
      createdAt: report.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const queue = loadQueue();
    queue.push(queueItem);
    saveQueue(queue);

    upsertReportRecord({
      uuid: queueItem.uuid || report.uuid,
      status: queueItem.status,
      reportType: queueItem.reportType,
      requestGroupId: queueItem.requestGroupId,
      chunkIndex: 1,
      totalChunks: 1,
      dateFrom: queueItem.dateFrom,
      dateTo: queueItem.dateTo,
      recovered: true
    });

    return queueItem;
  }

  async function discoverAndRecoverRemoteReport() {
    const reports = await discoverRemoteReports(20);
    const recoverable = reports.find(
      report => (report.status === "pending" || report.status === "ready") && report.uuid && report.uuid !== "-"
    );

    if (!recoverable) {
      return {
        recovered: false,
        reports
      };
    }

    const queueItem = recoverQueueFromRemoteReport(recoverable);

    return {
      recovered: true,
      report: recoverable,
      queueItem,
      reports
    };
  }

  async function getReportListItem(uuid) {
    const items = await getAllStatisticsList(100);
    return items.find(item => item.meta && item.meta.UUID === uuid) || null;
  }

  function getReportRecord(uuid) {
    return loadReports().find(item => item.uuid === uuid) || null;
  }

  function buildStoredRowKey(row, metadata, rowIndex) {
    return [
      formatDate(row.date),
      String(row.campaignId || ""),
      String(row.sku || ""),
      String(metadata.uuid || ""),
      String(rowIndex)
    ].join("|");
  }

  function savePerformanceRows(rows, metadata = {}) {
    const existing = loadStoredRows();
    const map = new Map(existing.map(item => [item.key, item]));
    const savedAt = new Date().toISOString();

    rows.forEach((row, rowIndex) => {
      const normalizedDate = formatDate(row.date);
      const key = buildStoredRowKey({ ...row, date: normalizedDate }, metadata, rowIndex);
      map.set(key, {
        key,
        row: {
          ...row,
          rawDate: row.rawDate || row.date || "",
          date: normalizedDate
        },
        metadata: {
          uuid: metadata.uuid || "",
          campaignIds: Array.isArray(metadata.campaignIds) ? metadata.campaignIds : [],
          dateFrom: metadata.dateFrom ? formatDate(metadata.dateFrom) : "",
          dateTo: metadata.dateTo ? formatDate(metadata.dateTo) : "",
          savedAt
        }
      });
    });

    const records = Array.from(map.values());
    saveStoredRows(records);
    return {
      totalStoredRows: records.length,
      rowsSaved: rows.length
    };
  }

  function clearStoredRows() {
    saveStoredRows([]);
    return { ok: true };
  }

  function getStoredRowsStatus() {
    const records = loadStoredRows();
    const dates = records
      .map(item => formatDate(item?.row?.date))
      .filter(Boolean)
      .sort();
    const campaignIds = new Set(
      records.map(item => String(item?.row?.campaignId || "")).filter(Boolean)
    );
    const skus = new Set(
      records.map(item => String(item?.row?.sku || "")).filter(Boolean)
    );

    return {
      totalStoredRows: records.length,
      minDate: dates[0] || "",
      maxDate: dates[dates.length - 1] || "",
      uniqueCampaigns: campaignIds.size,
      uniqueSkus: skus.size
    };
  }

  function getReportAgeMinutes(record) {
    const createdAt = record?.createdAt;
    if (!createdAt) {
      return null;
    }

    const diffMs = Date.now() - new Date(createdAt).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) {
      return null;
    }

    return Math.floor(diffMs / 60000);
  }

  function assertPollInterval(uuid, { bypassThrottle = false } = {}) {
    if (bypassThrottle) {
      return;
    }

    const record = getReportRecord(uuid);
    const lastPollAt = record?.lastPollAt;
    if (!lastPollAt) {
      return;
    }

    const nextAllowedAt = new Date(new Date(lastPollAt).getTime() + REPORT_POLL_MIN_INTERVAL_MS).toISOString();
    if (new Date(nextAllowedAt).getTime() > Date.now()) {
      throw createPollThrottleError(
        uuid,
        nextAllowedAt,
        "Не опрашивай UUID слишком часто. Следующая проверка после " + formatClockTime(nextAllowedAt) + "."
      );
    }
  }

  function markReportPolled(uuid, status) {
    const existing = getReportRecord(uuid);
    const retries = Number(existing?.retries || 0) + 1;

    upsertReportRecord({
      uuid,
      retries,
      lastKnownStatus: status,
      lastPollAt: new Date().toISOString()
    });
  }

  function persistReadyCsvReport(uuid, parsed, extra = {}) {
    clearActiveLimitTimestamp();
    const readyAt = new Date().toISOString();
    const existingRecord = getReportRecord(uuid) || {};

    upsertReportRecord({
      uuid,
      status: "ready",
      readyAt,
      rowsCount: parsed.rowsCount,
      rows: parsed.rows,
      lastKnownStatus: extra.lastKnownStatus || "CSV_READY",
      lastPollAt: readyAt,
      ...extra
    });
    savePerformanceRows(parsed.rows, {
      uuid,
      campaignIds: extra.campaignIds || existingRecord.campaignIds || [],
      dateFrom: extra.dateFrom || existingRecord.dateFrom || "",
      dateTo: extra.dateTo || existingRecord.dateTo || ""
    });

    const stored = getReportRecord(uuid);

    return {
      uuid,
      ready: true,
      status: "ready",
      rawStatus: extra.lastKnownStatus || "CSV_READY",
      ageMinutes: getReportAgeMinutes(stored),
      retries: Number(stored?.retries || 0),
      rows: parsed.rows,
      rowsCount: parsed.rowsCount
    };
  }

  async function getReportStatus(uuid, options = {}) {
    assertPollInterval(uuid, options);
    const found = await getReportListItem(uuid);

    if (found && found.meta && found.meta.error) {
      markReportPolled(uuid, "error");
      upsertReportRecord({
        uuid,
        status: "error",
        lastKnownStatus: "error",
        error: found.meta.error
      });
      throw new Error("Performance report failed: " + found.meta.error);
    }

    if (found && found.meta && found.meta.link) {
      clearActiveLimitTimestamp();
      markReportPolled(uuid, "ready");
      upsertReportRecord({
        uuid,
        status: "ready",
        readyAt: new Date().toISOString(),
        lastKnownStatus: "ready",
        link: found.meta.link
      });
      const stored = getReportRecord(uuid);
      return {
        uuid,
        ready: true,
        status: "ready",
        rawStatus: found.meta.status || found.status || found.state || "READY",
        ageMinutes: getReportAgeMinutes(stored),
        retries: Number(stored?.retries || 1),
        item: found
      };
    }

    const endpointResponse = await requestReportEndpoint(uuid);
    const parsedCsv = parseCsvReadyResponse(endpointResponse, { logger });

    if (parsedCsv) {
      markReportPolled(uuid, "CSV_READY");
      return persistReadyCsvReport(uuid, parsedCsv, {
        lastKnownStatus: found?.meta?.status || found?.status || found?.state || "CSV_READY"
      });
    }

    if (!found) {
      const stored = loadReports().find(item => item.uuid === uuid);
      markReportPolled(uuid, stored ? stored.status || "pending" : "not_found");
      return {
        uuid,
        ready: false,
        status: stored ? stored.status || "pending" : "pending",
        rawStatus: stored ? stored.status || "pending" : "not_found",
        ageMinutes: getReportAgeMinutes(stored),
        retries: Number(stored?.retries || 1),
        message: "Отчёт ещё готовится."
      };
    }

    const rawStatus = found.meta?.status || found.status || found.state || "IN_PROGRESS";
    markReportPolled(uuid, rawStatus);
    upsertReportRecord({
      uuid,
      status: "pending",
      lastKnownStatus: rawStatus
    });
    const stored = getReportRecord(uuid);

    return {
      uuid,
      ready: false,
      status: "pending",
      rawStatus,
      ageMinutes: getReportAgeMinutes(stored),
      retries: Number(stored?.retries || 1),
      item: found,
      message: "Отчёт ещё готовится."
    };
  }

  async function getReportDiagnostics(uuid) {
    const listItem = await getReportListItem(uuid);
    const record = getReportRecord(uuid);
    let reportEndpoint = null;

    try {
      reportEndpoint = await requestReportDownloadStatus(uuid);
    } catch (error) {
      reportEndpoint = {
        ok: false,
        error: error.message
      };
    }

    return {
      uuid,
      localRecord: record,
      listItem,
      reportEndpoint
    };
  }

  async function waitForReport(uuid, attempts = 12, delayMs = 5000) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const status = await getReportStatus(uuid, { bypassThrottle: true });

      if (status.ready) {
        return status;
      }

      if (attempt < attempts) {
        await delay(delayMs);
      }
    }

    throw createPendingReportError(uuid, "Отчёт ещё готовится.");
  }

  async function resolveReport(uuid) {
    const status = await getReportStatus(uuid, { bypassThrottle: true });

    if (!status.ready) {
      throw createPendingReportError(uuid, "Отчёт ещё готовится.");
    }

    if (Array.isArray(status.rows) && status.rows.length) {
      return {
        uuid,
        rows: status.rows,
        csvText: ""
      };
    }

    const csvText = await requestReportDownload(uuid);
    const rows = normalizeStatsFromCsv(csvText, { logger });
    upsertReportRecord({
      uuid,
      status: "ready",
      readyAt: new Date().toISOString(),
      rowsCount: rows.length,
      rows
    });
    const reportRecord = getReportRecord(uuid) || {};
    savePerformanceRows(rows, {
      uuid,
      campaignIds: reportRecord.campaignIds || [],
      dateFrom: reportRecord.dateFrom || "",
      dateTo: reportRecord.dateTo || ""
    });

    return {
      uuid,
      rows,
      csvText
    };
  }

  function buildQueueItems({ dateFrom, dateTo, activeOnly, toSheet, campaigns }) {
    const requestGroupId = createRequestGroupId();
    const campaignChunks = chunkArray(
      campaigns.map(item => item.campaignId),
      MAX_CAMPAIGNS_PER_REQUEST
    );

    return {
      requestGroupId,
      campaignsCount: campaigns.length,
      totalChunks: campaignChunks.length,
      items: campaignChunks.map((campaignIds, index) => ({
        requestGroupId,
        chunkIndex: index + 1,
        totalChunks: campaignChunks.length,
        campaignIds,
        dateFrom: formatDate(dateFrom),
        dateTo: formatDate(dateTo),
        activeOnly,
        toSheet: Boolean(toSheet),
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    };
  }

  async function startQueueItem(item) {
    try {
      const report = await createStatisticsReportRequest({
        campaignIds: item.campaignIds,
        dateFrom: item.dateFrom,
        dateTo: item.dateTo,
        reportType: "stats",
        requestGroupId: item.requestGroupId,
        chunkIndex: item.chunkIndex,
        totalChunks: item.totalChunks,
        activeOnly: item.activeOnly
      });

      return updateQueueItem(
        queueItem =>
          queueItem.requestGroupId === item.requestGroupId &&
          queueItem.chunkIndex === item.chunkIndex,
        {
          status: "pending",
          uuid: report.uuid
        }
      );
    } catch (error) {
      if (error.code === "PERFORMANCE_ACTIVE_LIMIT") {
        setActiveLimitTimestamp();
        return updateQueueItem(
          queueItem =>
            queueItem.requestGroupId === item.requestGroupId &&
            queueItem.chunkIndex === item.chunkIndex,
          {
            status: "queued"
          }
        );
      }

      throw error;
    }
  }

  async function createStatsQueue({ dateFrom, dateTo, activeOnly = false, toSheet = false }) {
    if (!isConfigured()) return null;

    const cooldownUntil = isActiveLimitCooldown();

    if (cooldownUntil) {
      throw createCooldownError(
        cooldownUntil,
        "Ждём освобождения лимита Ozon до " +
          formatClockTime(cooldownUntil) +
          ". Используй /performance discover raw для диагностики."
      );
    }

    const allCampaigns = await getCampaigns();
    const filteredCampaigns = activeOnly
      ? allCampaigns.filter(item => String(item.status || "").toLowerCase().includes("running"))
      : allCampaigns;
    const queueGroup = buildQueueItems({
      dateFrom,
      dateTo,
      activeOnly,
      toSheet,
      campaigns: filteredCampaigns
    });

    const existingQueue = loadQueue();
    saveQueue([...existingQueue, ...queueGroup.items]);

    let firstItem = queueGroup.items[0] || null;
    const hasPending = existingQueue.some(item => item.status === "pending");
    let startedFirst = false;

    if (firstItem && !hasPending) {
      firstItem = await startQueueItem(firstItem);
      startedFirst = firstItem && firstItem.status === "pending";
    }

    let recovered = null;

    if (firstItem && !startedFirst && !hasPending) {
      recovered = await discoverAndRecoverRemoteReport();
      if (!recovered.recovered) {
        setActiveLimitTimestamp();
      }
    }

    return {
      requestGroupId: queueGroup.requestGroupId,
      campaignsCount: filteredCampaigns.length,
      totalCampaigns: allCampaigns.length,
      activeOnly,
      totalChunks: queueGroup.totalChunks,
      startedFirst,
      hasPendingBefore: hasPending,
      firstItem,
      recovered,
      queuedItems: listQueue().filter(item => item.requestGroupId === queueGroup.requestGroupId)
    };
  }

  async function continueQueue() {
    let current = getCurrentPendingQueueItem();

    if (!current) {
      const next = getNextQueuedItem();

      if (!next) {
        const discovered = await discoverAndRecoverRemoteReport();

        if (discovered.recovered) {
          current = discovered.queueItem;

          if (current.status === "ready") {
            return {
              state: "recovered_ready",
              current
            };
          }

          return {
            state: "recovered",
            current
          };
        }

        return {
          state: "empty",
          discovered
        };
      }

      const started = await startQueueItem(next);

      if (started.status !== "pending") {
        return {
          state: "blocked"
        };
      }

      return {
        state: "started",
        current: started
      };
    }

    const status = await getReportStatus(current.uuid);

    if (!status.ready) {
      return {
        state: "pending",
        current
      };
    }

    const resolved = await resolveReport(current.uuid);
    current = updateQueueItem(
      item => item.requestGroupId === current.requestGroupId && item.chunkIndex === current.chunkIndex,
      {
        status: "ready",
        rowsCount: resolved.rows.length
      }
    );

    const next = listQueue().find(
      item => item.requestGroupId === current.requestGroupId && item.status === "queued"
    ) || getNextQueuedItem();

    if (!next) {
      return {
        state: "completed_chunk",
        completed: current,
        next: null
      };
    }

    const started = await startQueueItem(next);

    if (started.status !== "pending") {
      return {
        state: "active_limit",
        completed: current,
        next: started
      };
    }

    return {
      state: "completed_chunk",
      completed: current,
      next: started
    };
  }

  function getGroupItems(requestGroupId) {
    return listQueue().filter(item => item.requestGroupId === requestGroupId);
  }

  function getReportRows(uuid) {
    const record = loadReports().find(item => item.uuid === uuid);
    return Array.isArray(record?.rows) ? record.rows : [];
  }

  function getStoredRowsForDateRange(dateFrom, dateTo) {
    const from = formatDate(dateFrom);
    const to = formatDate(dateTo);

    return loadStoredRows()
      .map(item => item.row)
      .filter(row => {
        const date = formatDate(row.date || row.rawDate);
        return date && date >= from && date <= to;
      });
  }

  async function exportGroup(requestGroupId) {
    const items = getGroupItems(requestGroupId);

    if (!items.length) {
      throw new Error("Performance queue group not found: " + requestGroupId);
    }

    const missing = items
      .filter(item => item.status !== "ready")
      .map(item => ({
        chunkIndex: item.chunkIndex,
        totalChunks: item.totalChunks,
        uuid: item.uuid || ""
      }));

    if (missing.length) {
      return {
        ok: false,
        missing
      };
    }

    const combinedRows = items.flatMap(item => getReportRows(item.uuid));
    const writeResult = await sheetsService.clearAndWriteMappedRows(
      "performance_stats",
      statsToRows(combinedRows)
    );

    return {
      ok: true,
      rows: combinedRows,
      writeResult
    };
  }

  async function exportReport(uuid) {
    const resolved = await resolveReport(uuid);
    const reportRecord = getReportRecord(uuid) || {};
    savePerformanceRows(resolved.rows, {
      uuid,
      campaignIds: reportRecord.campaignIds || [],
      dateFrom: reportRecord.dateFrom || "",
      dateTo: reportRecord.dateTo || ""
    });
    const writeResult = await sheetsService.clearAndWriteMappedRows(
      "performance_stats",
      statsToRows(resolved.rows)
    );

    return {
      uuid,
      rows: resolved.rows,
      writeResult
    };
  }

  function campaignsToRows(campaigns) {
    return campaigns.map(campaign => [
      campaign.campaignId,
      campaign.campaignName,
      campaign.status,
      campaign.advObjectType,
      campaign.paymentType,
      campaign.fromDate,
      campaign.toDate,
      campaign.budget,
      campaign.dailyBudget,
      campaign.weeklyBudget,
      campaign.placement,
      campaign.productCampaignMode,
      campaign.createdAt,
      campaign.updatedAt
    ]);
  }

  function statsToRows(stats) {
    return stats.map(row => [
      row.date ?? "",
      row.campaignId ?? "",
      row.campaignName ?? "",
      row.sku ?? "",
      row.productName ?? "",
      row.price ?? "",
      row.impressions ?? "",
      row.clicks ?? "",
      row.ctr ?? "",
      row.addToCart ?? "",
      row.avgCpc ?? "",
      row.avgCpm ?? "",
      row.spend ?? "",
      row.orders ?? "",
      row.revenue ?? "",
      row.modelOrders ?? "",
      row.modelRevenue ?? "",
      row.drr ?? ""
    ]);
  }

  function summarizeStats(rows) {
    const totals = rows.reduce(
      (acc, row) => {
        acc.impressions += row.impressions || 0;
        acc.clicks += row.clicks || 0;
        acc.spend += row.spend || 0;
        acc.orders += row.orders || 0;
        acc.revenue += row.revenue || 0;
        return acc;
      },
      { impressions: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 }
    );

    return {
      rows: rows.length,
      impressions: totals.impressions,
      clicks: totals.clicks,
      spend: Number(totals.spend.toFixed(2)),
      orders: totals.orders,
      revenue: Number(totals.revenue.toFixed(2))
    };
  }

  async function writeCampaignsToMappedSheet(filters = {}) {
    const campaigns = await getCampaigns(filters);
    const result = await writeCampaignRowsToMappedSheet(campaigns);

    return {
      campaigns,
      sheetResult: result
    };
  }

  async function writeCampaignRowsToMappedSheet(campaigns) {
    return sheetsService.clearAndWriteMappedRows(
      "performance_campaigns",
      campaignsToRows(campaigns)
    );
  }

  async function debugSummary() {
    if (!isConfigured()) {
      return {
        configured: false,
        message: "Performance API credentials missing."
      };
    }

    const token = await getPerformanceToken();
    const campaigns = await getCampaigns();

    return {
      configured: true,
      tokenCached: Boolean(tokenCache),
      tokenExpiresAt: tokenCache ? new Date(tokenCache.expiresAt).toISOString() : null,
      campaignsCount: campaigns.length,
      sampleCampaigns: campaigns.slice(0, 5),
      remoteReports: await discoverRemoteReports(5),
      queueMeta: getQueueMeta(),
      queue: listQueue().slice(0, 20),
      authHeaderType: token ? "Bearer" : "missing"
    };
  }

  return {
    ACTIVE_LIMIT_COOLDOWN_MS,
    REPORT_POLL_MIN_INTERVAL_MS,
    campaignsToRows,
    chunkArray,
    continueQueue,
    createSingleCampaignStatsReport,
    createStatsQueue,
    createTestStatsReport,
    debugSummary,
    discoverAndRecoverRemoteReport,
    discoverRemoteReports,
    exportReport,
    exportGroup,
    formatBudgetValue,
    getBidLimits,
    getCampaigns,
    getCampaignObjects,
    getCurrentPendingQueueItem,
    clearStoredRows,
    getMinBidBySku,
    getPerformanceToken,
    getReportStatus,
    getReportDiagnostics,
    getStoredRowsStatus,
    getStatisticsList,
    getStatisticsListRaw,
    getGroupItems,
    getQueueMeta,
    getStoredRowsForDateRange,
    isConfigured,
    isActiveLimitCooldown,
    listQueue,
    looksLikeCsvReportBody,
    normalizeStatsFromCsv,
    parseCsvReadyResponse,
    resetQueue,
    resolveReport,
    savePerformanceRows,
    statsToRows,
    summarizeStats,
    waitForReport,
    writeCampaignRowsToMappedSheet,
    writeCampaignsToMappedSheet
  };
}

module.exports = {
  createActiveLimitError,
  createPendingReportError,
  createPerformanceService,
  inferPaymentType,
  looksLikeCsvReportBody,
  normalizeCampaign,
  normalizeStatsFromCsv,
  parseCsvReadyResponse,
  parseSemicolonCsv
};
