function createUnavailableError(message) {
  const error = new Error(message);
  error.code = "PERFORMANCE_UNAVAILABLE";
  return error;
}

function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
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

function normalizeCampaign(item) {
  return {
    campaignId: String(item.id ?? ""),
    campaignName: item.title ?? "",
    status: item.state ?? "",
    advObjectType: item.advObjectType ?? item.adv_object_type ?? "",
    paymentType: item.paymentType ?? "",
    fromDate: item.fromDate ?? "",
    toDate: item.toDate ?? "",
    budget: item.budget ?? "",
    dailyBudget: item.dailyBudget ?? "",
    placement: item.placement ?? ""
  };
}

function extractCampaignMeta(headerLine) {
  const text = String(headerLine || "");
  const idMatch = text.match(/№\s*(\d+)/);
  const nameMatch = text.match(/;\s*(.+?),\s*период/i);

  return {
    campaignId: idMatch ? idMatch[1] : "",
    campaignName: nameMatch ? nameMatch[1].trim() : ""
  };
}

function findHeaderRowIndex(rows) {
  return rows.findIndex(row => row.includes("sku") || row.includes("SKU"));
}

function getCell(row, indexMap, key) {
  const index = indexMap.get(key);
  if (index === undefined) return "";
  return row[index] ?? "";
}

function normalizeStatsFromCsv(csvText) {
  const rows = parseSemicolonCsv(csvText);
  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex === -1 || !rows[headerRowIndex + 1]) {
    throw new Error("Performance API returned unexpected report shape.");
  }

  const meta = extractCampaignMeta(rows[0]?.join(" "));
  const headers = rows[headerRowIndex];
  const dataRows = rows.slice(headerRowIndex + 1);
  const indexMap = new Map(headers.map((header, index) => [header.trim(), index]));
  const dateHeader = headers.find(header => header.includes("Дата"));

  return dataRows
    .filter(row => row.length && getCell(row, indexMap, "sku"))
    .map(row => ({
      date: dateHeader ? getCell(row, indexMap, dateHeader) : "",
      campaignId: meta.campaignId,
      campaignName: meta.campaignName,
      sku: getCell(row, indexMap, "sku"),
      productName: getCell(row, indexMap, "Название товара"),
      price: toNumber(getCell(row, indexMap, "Цена товара, Р")),
      impressions: toNumber(getCell(row, indexMap, "Показы")),
      clicks: toNumber(getCell(row, indexMap, "Клики")),
      ctr: toNumber(getCell(row, indexMap, "CTR (%)")),
      addToCart: toNumber(getCell(row, indexMap, "В корзину")),
      avgCpc: toNumber(getCell(row, indexMap, "Ср. цена клика, г")),
      avgCpm: toNumber(getCell(row, indexMap, "Ср. цена 1000 показов, Р")),
      spend: toNumber(getCell(row, indexMap, "Расход, Р, с НДС")),
      orders: toNumber(getCell(row, indexMap, "Заказы")),
      revenue: toNumber(getCell(row, indexMap, "Выручка, Р")),
      modelOrders: toNumber(getCell(row, indexMap, "Заказы модели")),
      modelRevenue: toNumber(getCell(row, indexMap, "Выручка с заказов модели, Р")),
      drr: toNumber(getCell(row, indexMap, "ДРР, %: Дата добавления")) ??
        toNumber(getCell(row, indexMap, "ДРР, %"))
    }));
}

function createPerformanceService({
  baseUrl,
  clientId,
  clientSecret,
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

  async function requestJson(path, options = {}) {
    assertConfigured();
    const token = await getPerformanceToken();
    const method = options.method || "GET";
    const url = new URL(baseUrl + path);

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
      throw new Error(message);
    }

    return data;
  }

  async function requestReportDownload(uuid) {
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

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Performance API report download failed: " + response.status);
    }

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (contentType.includes("application/zip")) {
      throw new Error(
        "Performance API returned ZIP report. Current implementation expects per-campaign CSV reports."
      );
    }

    if (!contentType.includes("csv") && !contentType.includes("text/plain")) {
      throw new Error("Performance API returned unexpected report content type: " + contentType);
    }

    return bodyText;
  }

  async function getCampaigns() {
    if (!isConfigured()) return [];

    const data = await requestJson("/api/client/campaign");
    const items = data.list;

    if (!Array.isArray(items)) {
      throw new Error("Performance API returned unexpected campaigns shape.");
    }

    return items.map(normalizeCampaign);
  }

  async function createStatisticsReportRequest({ campaignIds, dateFrom, dateTo }) {
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

    return data.UUID;
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

  async function waitForReport(uuid, attempts = 12, delayMs = 5000) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const items = await getStatisticsList(1, 100);
      const found = items.find(item => item.meta && item.meta.UUID === uuid);

      if (found && found.meta && found.meta.link) {
        return found;
      }

      if (found && found.meta && found.meta.error) {
        throw new Error("Performance report failed: " + found.meta.error);
      }

      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw new Error("Performance report is not ready yet. Try again later.");
  }

  async function getCampaignStats({ dateFrom, dateTo } = {}) {
    if (!isConfigured()) return [];

    const campaigns = await getCampaigns();
    const campaignRows = [];

    for (const campaign of campaigns) {
      const uuid = await createStatisticsReportRequest({
        campaignIds: [campaign.campaignId],
        dateFrom,
        dateTo
      });
      await waitForReport(uuid);
      const csvText = await requestReportDownload(uuid);
      const rows = normalizeStatsFromCsv(csvText).map(row => ({
        ...row,
        campaignId: row.campaignId || campaign.campaignId,
        campaignName: row.campaignName || campaign.campaignName
      }));
      campaignRows.push(...rows);
    }

    return campaignRows;
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
      campaign.placement
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

  async function writeCampaignsToMappedSheet() {
    const campaigns = await getCampaigns();
    const result = await sheetsService.clearAndWriteMappedRows(
      "performance_campaigns",
      campaignsToRows(campaigns)
    );

    return {
      campaigns,
      sheetResult: result
    };
  }

  async function writeStatsToMappedSheet({ dateFrom, dateTo }) {
    const stats = await getCampaignStats({ dateFrom, dateTo });
    const result = await sheetsService.clearAndWriteMappedRows(
      "performance_stats",
      statsToRows(stats)
    );

    return {
      stats,
      sheetResult: result
    };
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
      authHeaderType: token ? "Bearer" : "missing"
    };
  }

  return {
    campaignsToRows,
    debugSummary,
    getCampaigns,
    getCampaignStats,
    getPerformanceToken,
    getStatisticsList,
    isConfigured,
    normalizeStatsFromCsv,
    statsToRows,
    waitForReport,
    writeCampaignsToMappedSheet,
    writeStatsToMappedSheet
  };
}

module.exports = {
  createPerformanceService,
  normalizeStatsFromCsv,
  parseSemicolonCsv
};
