function createUnavailableError(message) {
  const error = new Error(message);
  error.code = "PERFORMANCE_UNAVAILABLE";
  return error;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeCampaign(item) {
  return {
    campaignId: item.id ?? item.campaign_id ?? item.campaignId ?? "",
    campaignName: item.title ?? item.name ?? item.campaign_name ?? "",
    status: item.state ?? item.status ?? "",
    type: item.adv_object_type ?? item.type ?? ""
  };
}

function normalizeStatRow(item, fallback = {}) {
  const impressions = toNumber(item.impressions ?? item.shows ?? item.views);
  const clicks = toNumber(item.clicks);
  const spend = toNumber(item.spend ?? item.cost ?? item.money_spent);
  const orders = toNumber(item.orders ?? item.attributed_orders);
  const revenue = toNumber(item.revenue ?? item.sales ?? item.attributed_revenue);
  const ctr = toNumber(item.ctr) ?? (
    impressions && clicks !== null ? Number(((clicks / impressions) * 100).toFixed(2)) : null
  );
  const cpc = toNumber(item.cpc) ?? (
    spend !== null && clicks ? Number((spend / clicks).toFixed(2)) : null
  );
  const roas = toNumber(item.roas) ?? (
    spend && revenue !== null ? Number((revenue / spend).toFixed(2)) : null
  );
  const drr = toNumber(item.drr) ?? (
    revenue && spend !== null ? Number(((spend / revenue) * 100).toFixed(2)) : null
  );

  return {
    date: formatDate(item.date ?? item.day ?? fallback.date),
    campaignId: item.campaign_id ?? item.campaignId ?? fallback.campaignId ?? "",
    campaignName: item.campaign_name ?? item.campaignName ?? fallback.campaignName ?? "",
    sku: item.sku ?? item.offer_id ?? item.offerId ?? "",
    impressions,
    clicks,
    ctr,
    cpc,
    spend,
    orders,
    revenue,
    drr,
    roas
  };
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
      logger.error("[performance] token request failed");
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

  async function requestPerformance(path, options = {}) {
    assertConfigured();

    const token = await getPerformanceToken();
    const method = options.method || "GET";
    const response = await fetch(baseUrl + path, {
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
        "Performance API вернул ошибку: " + response.status;
      throw new Error(message);
    }

    return data;
  }

  async function getCampaigns() {
    if (!isConfigured()) return [];

    const data = await requestPerformance("/api/client/campaign");
    const items = Array.isArray(data) ? data : data.list || data.result || data.campaigns || [];
    return items.map(normalizeCampaign);
  }

  async function getCampaignStats({ dateFrom, dateTo } = {}) {
    if (!isConfigured()) return [];

    const campaigns = await getCampaigns();
    if (!campaigns.length) return [];

    const body = {
      campaign_ids: campaigns.map(item => item.campaignId),
      from: formatDate(dateFrom),
      to: formatDate(dateTo)
    };

    const data = await requestPerformance("/api/client/statistics/json", {
      method: "POST",
      body
    });

    const items = Array.isArray(data) ? data : data.rows || data.result || data.statistics || [];
    const campaignMap = new Map(campaigns.map(item => [String(item.campaignId), item]));

    return items.map(item => {
      const campaign = campaignMap.get(String(item.campaign_id ?? item.campaignId)) || {};
      return normalizeStatRow(item, campaign);
    });
  }

  async function getCampaignSkuStats({ dateFrom, dateTo } = {}) {
    if (!isConfigured()) return [];

    const campaigns = await getCampaigns();
    if (!campaigns.length) return [];

    const body = {
      campaign_ids: campaigns.map(item => item.campaignId),
      from: formatDate(dateFrom),
      to: formatDate(dateTo),
      group_by: "sku"
    };

    const endpoints = [
      "/api/client/statistics/sku",
      "/api/client/statistics/json"
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const data = await requestPerformance(endpoint, {
          method: "POST",
          body
        });

        const items = Array.isArray(data) ? data : data.rows || data.result || data.statistics || [];
        const campaignMap = new Map(campaigns.map(item => [String(item.campaignId), item]));

        return items.map(item => {
          const campaign = campaignMap.get(String(item.campaign_id ?? item.campaignId)) || {};
          return normalizeStatRow(item, campaign);
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      "SKU-статистика Performance API недоступна в текущей конфигурации." +
        (lastError ? " " + lastError.message : "")
    );
  }

  function toSheetRows(rows) {
    return [
      ["Дата", "Campaign ID", "Campaign Name", "SKU", "Показы", "Клики", "CTR", "CPC", "Расход", "Заказы", "Выручка", "ДРР", "ROAS"],
      ...rows.map(row => [
        row.date ?? "",
        row.campaignId ?? "",
        row.campaignName ?? "",
        row.sku ?? "",
        row.impressions ?? "",
        row.clicks ?? "",
        row.ctr ?? "",
        row.cpc ?? "",
        row.spend ?? "",
        row.orders ?? "",
        row.revenue ?? "",
        row.drr ?? "",
        row.roas ?? ""
      ])
    ];
  }

  async function syncCampaignsToSheets() {
    const campaigns = await getCampaigns();
    if (!campaigns.length) return campaigns;

    const rows = [
      ["Дата", "Campaign ID", "Campaign Name", "SKU", "Показы", "Клики", "CTR", "CPC", "Расход", "Заказы", "Выручка", "ДРР", "ROAS"],
      ...campaigns.map(item => [
        formatDate(),
        item.campaignId,
        item.campaignName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ])
    ];

    await sheetsService.addRows("Ozon_Performance_Campaigns", rows);
    return campaigns;
  }

  async function syncStatsToSheets() {
    const stats = await getCampaignStats();
    if (!stats.length) return stats;

    await sheetsService.addRows("Ozon_Performance_Stats", toSheetRows(stats));
    return stats;
  }

  async function syncSkuStatsToSheets() {
    const stats = await getCampaignSkuStats();
    if (!stats.length) return stats;

    await sheetsService.addRows("Ozon_Performance_SKU", toSheetRows(stats));
    return stats;
  }

  return {
    getCampaigns,
    getCampaignSkuStats,
    getCampaignStats,
    getPerformanceToken,
    isConfigured,
    syncCampaignsToSheets,
    syncSkuStatsToSheets,
    syncStatsToSheets
  };
}

module.exports = {
  createPerformanceService
};
