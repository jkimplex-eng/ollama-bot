function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortByDescending(items, field) {
  return [...items].sort((left, right) => {
    const leftValue = toNumber(left[field]) ?? -1;
    const rightValue = toNumber(right[field]) ?? -1;
    return rightValue - leftValue;
  });
}

function sortByAscending(items, field) {
  return [...items].sort((left, right) => {
    const leftValue = toNumber(left[field]);
    const rightValue = toNumber(right[field]);

    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return leftValue - rightValue;
  });
}

function normalizeProduct(product) {
  return {
    name: product.name ?? "",
    sku: product.sku ?? product.offerId ?? product.productId ?? "",
    price: toNumber(product.price),
    stock: toNumber(product.stock),
    productId: product.productId ?? "",
    offerId: product.offerId ?? ""
  };
}

function mergeProductData(products, stocks) {
  const stockMap = new Map(
    stocks.map(product => [
      String(product.sku || product.offerId || product.productId || product.name),
      normalizeProduct(product)
    ])
  );

  return products.map(product => {
    const normalized = normalizeProduct(product);
    const stockData =
      stockMap.get(
        String(normalized.sku || normalized.offerId || normalized.productId || normalized.name)
      ) || {};

    return {
      ...normalized,
      stock: stockData.stock ?? normalized.stock
    };
  });
}

function summarize(products) {
  const priced = products.filter(product => product.price !== null);
  const withStock = products.filter(product => product.stock !== null);

  return {
    totalProducts: products.length,
    withPrice: priced.length,
    withoutPrice: products.length - priced.length,
    inStock: withStock.filter(product => product.stock > 0).length,
    outOfStock: withStock.filter(product => product.stock === 0).length,
    lowStock: withStock.filter(product => product.stock > 0 && product.stock <= 5).length,
    missingStock: products.length - withStock.length,
    averagePrice: priced.length
      ? Math.round(priced.reduce((sum, product) => sum + product.price, 0) / priced.length)
      : null
  };
}

function compactProducts(products) {
  return products.map(product => ({
    name: product.name,
    sku: product.sku,
    price: product.price,
    stock: product.stock
  }));
}

function summarizePerformance(stats) {
  const totals = stats.reduce(
    (acc, row) => {
      acc.impressions += row.impressions ?? 0;
      acc.clicks += row.clicks ?? 0;
      acc.spend += row.spend ?? 0;
      acc.orders += row.orders ?? 0;
      acc.revenue += row.revenue ?? 0;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 }
  );

  return {
    ...totals,
    ctr: totals.impressions ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : null,
    roas: totals.spend ? Number((totals.revenue / totals.spend).toFixed(2)) : null,
    drr: totals.revenue ? Number(((totals.spend / totals.revenue) * 100).toFixed(2)) : null
  };
}

function buildCompactPayload(topic, products, stocks, jobsStatus, performance) {
  const summary = summarize(products);
  const strongProducts = compactProducts(
    sortByDescending(
      products.filter(product => product.price !== null && (product.stock ?? 0) > 5),
      "price"
    ).slice(0, 10)
  );
  const weakProducts = compactProducts(
    sortByAscending(
      products.filter(product => product.stock === 0 || product.price === null),
      "stock"
    ).slice(0, 10)
  );
  const lowStockProducts = compactProducts(
    sortByAscending(
      products.filter(product => product.stock !== null && product.stock <= 5),
      "stock"
    ).slice(0, 10)
  );
  const promotableProducts = compactProducts(
    sortByDescending(
      products.filter(product => product.price !== null && (product.stock ?? 0) > 10),
      "price"
    ).slice(0, 10)
  );

  return {
    topic,
    generatedAt: new Date().toISOString(),
    summary,
    jobs: jobsStatus
      ? {
          running: jobsStatus.running,
          lastSuccessAt: jobsStatus.lastSuccessAt,
          lastError: jobsStatus.lastError
        }
      : null,
    dataAvailability: {
      products: products.length > 0,
      stocks: stocks.length > 0,
      directSalesMetrics: false,
      directAdsMetrics: performance.stats.length > 0 || performance.skuStats.length > 0
    },
    performanceSummary: performance.summary,
    performanceCampaigns: performance.campaigns.slice(0, 20),
    performanceStats: performance.stats.slice(0, 20),
    performanceSkuStats: performance.skuStats.slice(0, 20),
    strongProducts,
    weakProducts,
    lowStockProducts,
    promotableProducts,
    sampleProducts: compactProducts(products.slice(0, 20))
  };
}

function buildAnalyticsPrompt(topic, payload) {
  const topicLabels = {
    overview: "общая картина",
    sales: "продажи",
    ads: "реклама",
    stocks: "остатки",
    issues: "проблемы"
  };

  return [
    "Ты сильный русскоязычный Ozon-аналитик для e-commerce бизнеса.",
    "Проанализируй только данные из JSON. Не придумывай метрики, которых нет.",
    "Если прямых данных продаж или рекламы нет, прямо напиши: Прямые данные продаж/рекламы пока не подключены.",
    "Тема: " + topicLabels[topic],
    "",
    "Сделай ответ в таком формате:",
    "1. Краткий вывод",
    "2. Сильные товары",
    "3. Слабые товары",
    "4. Риски остатков",
    "5. Что продвигать",
    "6. Что проверить",
    "7. Конкретные действия",
    "",
    "Пиши по-русски, по делу, в бизнес-стиле.",
    "",
    "JSON:",
    JSON.stringify(payload)
  ].join("\n");
}

function createAnalyticsService({ jobsService, ollamaService, ozonService, performanceService }) {
  async function collectPerformanceData() {
    if (!performanceService || !performanceService.isConfigured()) {
      return {
        campaigns: [],
        stats: [],
        skuStats: [],
        summary: null
      };
    }

    const [campaigns, stats, skuStats] = await Promise.all([
      performanceService.getCampaigns().catch(() => []),
      performanceService.getCampaignStats().catch(() => []),
      performanceService.getCampaignSkuStats().catch(() => [])
    ]);

    return {
      campaigns,
      stats,
      skuStats,
      summary: summarizePerformance(stats)
    };
  }

  async function collectSnapshot(topic) {
    const [productsRaw, stocksRaw] = await Promise.all([
      ozonService.getProducts(100),
      ozonService.getStocks(100).catch(() => [])
    ]);

    const products = mergeProductData(productsRaw, stocksRaw);
    const stocks = stocksRaw.map(normalizeProduct);
    const jobsStatus = jobsService ? jobsService.getStatus() : null;
    const performance = await collectPerformanceData();

    return buildCompactPayload(topic, products, stocks, jobsStatus, performance);
  }

  async function analyze(topic = "overview") {
    const allowedTopics = new Set(["overview", "sales", "ads", "stocks", "issues"]);

    if (!allowedTopics.has(topic)) {
      throw new Error("Неизвестная тема аналитики");
    }

    const payload = await collectSnapshot(topic);
    const prompt = buildAnalyticsPrompt(topic, payload);
    const reply = await ollamaService.askAnalytics(prompt);

    return {
      topic,
      reply,
      payload
    };
  }

  return {
    analyze,
    collectSnapshot
  };
}

module.exports = {
  createAnalyticsService
};
