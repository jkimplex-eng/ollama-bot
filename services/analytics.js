const MAX_PRODUCTS = 20;
const MAX_STOCK_ROWS = 20;
const MAX_PERFORMANCE_ROWS = 20;

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
    offerId: product.offerId,
    price: product.price,
    stock: product.stock
  }));
}

function compactPerformanceRows(rows) {
  return rows.slice(0, MAX_PERFORMANCE_ROWS).map(row => ({
    campaignName: row.campaignName || "",
    sku: row.sku || "",
    spend: row.spend ?? null,
    orders: row.orders ?? null,
    revenue: row.revenue ?? null,
    roas: row.roas ?? null,
    drr: row.drr ?? null
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
  const limitedProducts = products.slice(0, MAX_PRODUCTS);
  const limitedStocks = stocks.slice(0, MAX_STOCK_ROWS);
  const missingOfferIdCount = limitedProducts.filter(product => !product.offerId).length;
  const suitableForReviewCount = limitedProducts.filter(product => {
    const missingPrice = product.price === null;
    const missingStock = product.stock === null;
    const noOfferId = !product.offerId;
    const lowStock = product.stock !== null && product.stock <= 5;
    return missingPrice || missingStock || noOfferId || lowStock;
  }).length;
  const summary = summarize(limitedProducts);
  const strongProducts = compactProducts(
    sortByDescending(
      limitedProducts.filter(product => product.price !== null && (product.stock ?? 0) > 5),
      "price"
    ).slice(0, 8)
  );
  const weakProducts = compactProducts(
    sortByAscending(
      limitedProducts.filter(product => product.stock === 0 || product.price === null),
      "stock"
    ).slice(0, 8)
  );
  const lowStockProducts = compactProducts(
    sortByAscending(
      limitedProducts.filter(product => product.stock !== null && product.stock <= 5),
      "stock"
    ).slice(0, 8)
  );
  const promotableProducts = compactProducts(
    sortByDescending(
      limitedProducts.filter(product => product.price !== null && (product.stock ?? 0) > 10),
      "price"
    ).slice(0, 8)
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
      directAdsMetrics: performance.stats.length > 0
    },
    performanceSummary: performance.summary,
    quickMetrics: {
      checkedProducts: limitedProducts.length,
      missingOfferIdCount,
      suitableForReviewCount,
      lowStockCount: summary.lowStock,
      stocksAvailable: limitedStocks.length > 0
    },
    topCampaigns: performance.campaigns.slice(0, 8).map(item => ({
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      status: item.status
    })),
    performanceStats: compactPerformanceRows(performance.stats),
    strongProducts,
    weakProducts,
    lowStockProducts,
    promotableProducts,
    sampleProducts: compactProducts(limitedProducts),
    stockRows: compactProducts(limitedStocks)
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
    "Используй только данные из JSON. Не придумывай метрики.",
    "Если прямых данных продаж или рекламы нет, прямо напиши: Прямые данные продаж/рекламы пока не подключены.",
    "Тема: " + topicLabels[topic],
    "",
    "Формат:",
    "1. Краткий вывод",
    "2. Сильные товары",
    "3. Слабые товары",
    "4. Риски остатков",
    "5. Что продвигать",
    "6. Что проверить",
    "7. Конкретные действия",
    "",
    JSON.stringify(payload)
  ].join("\n");
}

function buildDeterministicSummary(topic, payload, reason) {
  const performance = payload.performanceSummary;
  const lines = [
    "Ollama недоступен, показываю детерминированную сводку.",
    "Причина: " + reason,
    "",
    "Тема: " + topic,
    "Товаров в выборке: " + payload.summary.totalProducts,
    "В наличии: " + payload.summary.inStock,
    "Нет в наличии: " + payload.summary.outOfStock,
    "Низкий остаток: " + payload.summary.lowStock,
    "Без цены: " + payload.summary.withoutPrice
  ];

  if (performance) {
    lines.push(
      "Реклама: расход " +
        performance.spend +
        ", заказы " +
        performance.orders +
        ", выручка " +
        performance.revenue
    );
  } else {
    lines.push("Прямые данные продаж/рекламы пока не подключены.");
  }

  if (payload.strongProducts.length) {
    lines.push("", "Сильные товары:");
    for (const item of payload.strongProducts.slice(0, 5)) {
      lines.push("- " + (item.name || item.sku) + " | цена: " + (item.price ?? "-") + " | остаток: " + (item.stock ?? "-"));
    }
  }

  if (payload.lowStockProducts.length) {
    lines.push("", "Риски остатков:");
    for (const item of payload.lowStockProducts.slice(0, 5)) {
      lines.push("- " + (item.name || item.sku) + " | остаток: " + (item.stock ?? "-"));
    }
  }

  lines.push("", "Конкретные действия:");
  lines.push("- Проверь товары без цены и без остатка.");
  lines.push("- Поддерживай остаток по сильным товарам.");
  lines.push("- Не запускай рекламу на SKU с низким остатком.");

  return lines.join("\n");
}

function createAnalyticsService({ jobsService, ollamaService, ozonService, performanceService }) {
  async function collectPerformanceData() {
    if (!performanceService || !performanceService.isConfigured()) {
      return {
        campaigns: [],
        stats: [],
        summary: null
      };
    }

    const [campaigns, stats] = await Promise.all([
      performanceService.getCampaigns().catch(() => []),
      performanceService.getCampaignStats().catch(() => [])
    ]);

    return {
      campaigns: campaigns.slice(0, MAX_PERFORMANCE_ROWS),
      stats: stats.slice(0, MAX_PERFORMANCE_ROWS),
      summary: summarizePerformance(stats)
    };
  }

  async function collectSnapshot(topic) {
    const [productsRaw, stocksRaw] = await Promise.all([
      ozonService.getProducts(MAX_PRODUCTS),
      ozonService.getStocks(MAX_STOCK_ROWS).catch(() => [])
    ]);

    const products = mergeProductData(productsRaw, stocksRaw);
    const stocks = stocksRaw.map(normalizeProduct).slice(0, MAX_STOCK_ROWS);
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

    try {
      const reply = await ollamaService.askAnalytics(prompt, {
        endpoint: "telegram-analytics"
      });

      return {
        topic,
        reply,
        payload,
        fallbackUsed: false
      };
    } catch (error) {
      return {
        topic,
        reply: buildDeterministicSummary(topic, payload, error.message),
        payload,
        fallbackUsed: true
      };
    }
  }

  return {
    analyze,
    buildDeterministicSummary,
    collectSnapshot
  };
}

module.exports = {
  createAnalyticsService
};
