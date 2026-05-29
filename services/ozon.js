function clampOzonLimit(value, max = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return max;
  }
  return Math.min(parsed, max);
}

function getPostingIdentity(item) {
  return String(
    item?.posting_number ||
      item?.order_id ||
      item?.posting_id ||
      item?.id ||
      ""
  );
}

function getPageSignature(postings) {
  const ids = postings.map(getPostingIdentity).filter(Boolean);
  return JSON.stringify({
    count: postings.length,
    firstPostingId: ids[0] || "",
    lastPostingId: ids[ids.length - 1] || ""
  });
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "object") {
    if (value && "amount" in value) {
      return normalizeMoney(value.amount);
    }
    return 0;
  }
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeBodyPreview(value, maxLength = 300) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseJsonString(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return {};
  }
  return JSON.parse(normalized);
}

function createOzonService({ clientId, apiKey }) {
  async function parseOzonResponse(response, path) {
    if (typeof response.text === "function") {
      const rawText = await response.text();
      try {
        return parseJsonString(rawText);
      } catch (error) {
        console.log("[ozon] invalid response body", {
          path,
          preview: safeBodyPreview(rawText)
        });
        throw new Error(
          "Ozon returned invalid JSON for " + path + ". Preview: " + safeBodyPreview(rawText)
        );
      }
    }

    if (typeof response.json === "function") {
      const payload = await response.json();
      if (typeof payload === "string") {
        try {
          return parseJsonString(payload);
        } catch (error) {
          console.log("[ozon] invalid response payload", {
            path,
            preview: safeBodyPreview(payload)
          });
          throw new Error(
            "Ozon returned invalid JSON payload for " + path + ". Preview: " + safeBodyPreview(payload)
          );
        }
      }
      if (payload && typeof payload === "object") {
        return payload;
      }
      return {};
    }

    return {};
  }

  async function requestOzon(path, body) {
    if (!clientId || !apiKey) {
      throw new Error("OZON_CLIENT_ID или OZON_API_KEY не найден в .env");
    }

    const response = await fetch("https://api-seller.ozon.ru" + path, {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await parseOzonResponse(response, path);

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    return data;
  }

  function normalizeLimit(limit) {
    const value = limit === undefined || limit === null || limit === "" ? 10 : Number(limit);

    if (!Number.isInteger(value) || value < 1) {
      throw new Error("Лимит должен быть целым числом больше 0");
    }

    return Math.min(value, 1000);
  }

  function normalizeOzonError(error) {
    const message = String(error?.message || error || "");
    if (message.includes("Request validation error")) {
      return "Ozon отклонил запрос из-за параметров выборки. Попробуй ещё раз, мы уже ограничили размер страницы безопасным значением.";
    }
    return message;
  }

  function buildTextHaystack(...parts) {
    return parts
      .filter(Boolean)
      .map(value => String(value).toLowerCase())
      .join(" ");
  }

  function getCityForWarehouse(warehouseId, warehouseName) {
    const name = String(warehouseName || "").toLowerCase();
    const id = String(warehouseId || "");

    if (name.includes("хоругвино") || name.includes("пушкино") || name.includes("москва") || name.includes("мск") || id === "987654") {
      return "Москва";
    }
    if (name.includes("шушары") || name.includes("спб") || name.includes("санкт") || name.includes("питер")) {
      return "СПб";
    }
    if (name.includes("зеленодольск") || name.includes("казань") || name.includes("кзн")) {
      return "Казань";
    }
    return "unknown";
  }

  function getStock(product) {
    const stocks = product.stocks;

    if (Array.isArray(stocks)) {
      const total = stocks.reduce((sum, item) => {
        const present = Number(item.present ?? item.stock ?? 0);
        const reserved = Number(item.reserved ?? 0);
        const available = item.available !== undefined ? Number(item.available) : Math.max(0, present - reserved);
        return sum + available;
      }, 0);

      return total;
    }

    if (typeof stocks === "number") return stocks;
    if (!stocks || typeof stocks !== "object") return 0;
    
    const present = Number(stocks.present ?? stocks.stock ?? 0);
    const reserved = Number(stocks.reserved ?? 0);
    const available = stocks.available !== undefined ? Number(stocks.available) : Math.max(0, present - reserved);
    return available;
  }

  function normalizeProduct(product) {
    return {
      name: product.name ?? product.title ?? "",
      sku: product.sku ?? product.offer_id ?? product.product_id ?? "",
      price: product.price ?? product.marketing_price ?? product.old_price ?? "",
      stock: getStock(product),
      productId: product.product_id ?? product.id ?? "",
      offerId: product.offer_id ?? "",
      stocks: product.stocks ?? []
    };
  }

  function normalizeStock(stock, detailsByProductId, detailsByOfferId) {
    const details =
      detailsByProductId.get(String(stock.product_id ?? "")) ||
      detailsByOfferId.get(String(stock.offer_id ?? "")) ||
      {};

    return normalizeProduct({
      ...details,
      product_id: stock.product_id ?? details.product_id,
      offer_id: stock.offer_id ?? details.offer_id,
      sku: stock.sku ?? details.sku,
      stocks: stock.stocks ?? details.stocks
    });
  }

  function aggregateNormalizedStocks(rows) {
    const map = new Map();

    for (const row of rows) {
      const key = String(row.sku || row.offerId || row.productId || "");
      const current = map.get(key) || {
        name: row.productName || "",
        sku: row.sku || "",
        price: "",
        stock: 0,
        productId: row.productId || "",
        offerId: row.offerId || "",
        stocks: []
      };
      current.stock += toNumber(row.available) || 0;
      current.stocks.push({
        warehouseId: row.warehouseId || "",
        warehouseName: row.warehouseName || "",
        present: toNumber(row.present) || 0,
        reserved: toNumber(row.reserved) || 0,
        available: toNumber(row.available) || 0,
        city: row.city || "unknown",
        cluster: row.cluster || ""
      });
      map.set(key, current);
    }

    return Array.from(map.values());
  }

  function buildProductDetailMaps(details) {
    return {
      byProductId: new Map(
        details
          .filter(product => product.product_id !== undefined && product.product_id !== null)
          .map(product => [String(product.product_id), product])
      ),
      byOfferId: new Map(
        details
          .filter(product => product.offer_id !== undefined && product.offer_id !== null)
          .map(product => [String(product.offer_id), product])
      ),
      bySku: new Map(
        details
          .filter(product => product.sku !== undefined && product.sku !== null)
          .map(product => [String(product.sku), product])
      )
    };
  }

  function extractArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  }

  function firstNonEmptyArray(...candidates) {
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) {
        return candidate;
      }
    }
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
    return [];
  }

  function extractStockItemsFromV4(payload) {
    return firstNonEmptyArray(
      payload?.result?.items,
      payload?.items,
      payload?.result?.stocks,
      payload?.stocks
    );
  }

  function extractStockItemsFromWarehouseResponse(payload) {
    return firstNonEmptyArray(
      payload?.result?.rows,
      payload?.result?.items,
      payload?.result?.stocks,
      payload?.rows,
      payload?.items,
      payload?.stocks
    );
  }

  function extractWarehouseList(payload) {
    return firstNonEmptyArray(
      payload?.result,
      payload?.result?.warehouses,
      payload?.warehouses,
      payload?.items
    );
  }

  function normalizeWarehouseReference(item) {
    return {
      warehouseId: String(item?.warehouse_id ?? item?.id ?? item?.warehouseId ?? ""),
      warehouseName: String(item?.name ?? item?.warehouse_name ?? item?.warehouseName ?? ""),
      city: String(item?.city ?? item?.address?.city ?? item?.location?.city ?? "").trim(),
      cluster: String(item?.cluster ?? item?.cluster_name ?? item?.region ?? "").trim()
    };
  }

  function normalizeStockValue(value) {
    return toNumber(value);
  }

  function normalizeStockRow(stockItem, warehouseRefs, detailMaps, source) {
    const productId = String(
      stockItem?.product_id ??
        stockItem?.productId ??
        stockItem?.item?.product_id ??
        ""
    );
    const sku = String(
      stockItem?.sku ??
        stockItem?.item?.sku ??
        stockItem?.product?.sku ??
        ""
    ).trim();
    const offerId = String(
      stockItem?.offer_id ??
        stockItem?.offerId ??
        stockItem?.item?.offer_id ??
        stockItem?.product?.offer_id ??
        ""
    ).trim();
    const warehouseId = String(
      stockItem?.warehouse_id ??
        stockItem?.warehouseId ??
        stockItem?.warehouse?.warehouse_id ??
        stockItem?.warehouse?.id ??
        ""
    ).trim();
    const warehouseNameRaw =
      stockItem?.warehouse_name ??
      stockItem?.warehouseName ??
      stockItem?.warehouse?.name ??
      "";
    const present = normalizeStockValue(
      stockItem?.present ??
        stockItem?.stock ??
        stockItem?.stocks?.present ??
        stockItem?.item?.present ??
        0
    );
    const reserved = normalizeStockValue(
      stockItem?.reserved ??
        stockItem?.stocks?.reserved ??
        stockItem?.item?.reserved ??
        0
    );
    const availableRaw =
      stockItem?.available ??
      stockItem?.stocks?.available ??
      stockItem?.item?.available;
    const available =
      availableRaw === undefined || availableRaw === null || availableRaw === ""
        ? present - reserved
        : normalizeStockValue(availableRaw);

    const details =
      detailMaps.byProductId.get(productId) ||
      detailMaps.byOfferId.get(offerId) ||
      detailMaps.bySku.get(sku) ||
      {};
    const warehouseRef =
      warehouseRefs.byId.get(warehouseId) ||
      warehouseRefs.byName.get(String(warehouseNameRaw).trim().toLowerCase()) ||
      null;
    const warehouseName = String(
      warehouseNameRaw || warehouseRef?.warehouseName || ""
    ).trim();

    return {
      sku: sku || String(details.sku || "").trim(),
      offerId: offerId || String(details.offer_id || "").trim(),
      productId: productId || String(details.product_id || ""),
      warehouseId,
      warehouseName,
      present: Number(present.toFixed(2)),
      reserved: Number(reserved.toFixed(2)),
      available: Number(Math.max(0, available).toFixed(2)),
      city: warehouseRef?.city || "unknown",
      cluster: warehouseRef?.cluster || "",
      source
    };
  }

  function aggregateNormalizedStocks(rows, detailMaps) {
    const grouped = new Map();

    for (const row of rows) {
      const key = [
        row.productId || "",
        row.offerId || "",
        row.sku || ""
      ].join("|");
      const current = grouped.get(key) || {
        sku: row.sku || "",
        offerId: row.offerId || "",
        productId: row.productId || "",
        stocks: [],
        stock: 0,
        price: "",
        name: ""
      };
      current.stocks.push({
        warehouse_id: row.warehouseId,
        warehouse_name: row.warehouseName,
        present: row.present,
        reserved: row.reserved,
        available: row.available,
        city: row.city,
        cluster: row.cluster
      });
      current.stock += row.available;
      const details =
        detailMaps.byProductId.get(current.productId) ||
        detailMaps.byOfferId.get(current.offerId) ||
        detailMaps.bySku.get(current.sku) ||
        null;
      if (details) {
        current.price = current.price || details.price || details.marketing_price || details.old_price || "";
        current.name = current.name || details.name || details.title || "";
        current.sku = current.sku || String(details.sku || "").trim();
        current.offerId = current.offerId || String(details.offer_id || "").trim();
      }
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).map(item => ({
      name: item.name,
      sku: item.sku,
      price: item.price,
      stock: Number(item.stock.toFixed(2)),
      productId: item.productId,
      offerId: item.offerId,
      stocks: item.stocks
    }));
  }

  function formatDate(value) {
    const normalized = String(value || "").trim();
    const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? normalized.slice(0, 10) : parsed.toISOString().slice(0, 10);
  }

  function toNumber(value) {
    const number = normalizeMoney(value);
    return Number.isFinite(number) ? number : 0;
  }

  function findFinancialProduct(product, posting) {
    const financialProducts = Array.isArray(posting?.financial_data?.products)
      ? posting.financial_data.products
      : [];
    if (!financialProducts.length) {
      return null;
    }

    const productSku = String(product?.sku || product?.item?.sku || "");
    const offerId = String(product?.offer_id || product?.offerId || "");
    const productId = String(product?.product_id || product?.productId || "");

    return (
      financialProducts.find(item => String(item.sku || item?.item?.sku || "") === productSku && productSku) ||
      financialProducts.find(item => String(item.offer_id || item.offerId || "") === offerId && offerId) ||
      financialProducts.find(item => String(item.product_id || item.productId || "") === productId && productId) ||
      null
    );
  }

  function getRawSalesDebug(product, posting, financialProduct) {
    return {
      postingNumber: posting?.posting_number || posting?.order_id || "",
      offerId: product?.offer_id || product?.offerId || financialProduct?.offer_id || "",
      sku: product?.sku || product?.item?.sku || financialProduct?.sku || "",
      productName:
        product?.name ||
        product?.product_name ||
        product?.item?.name ||
        financialProduct?.name ||
        "",
      quantity:
        product?.quantity ??
        product?.qty ??
        financialProduct?.quantity ??
        financialProduct?.qty ??
        1,
      price: product?.price,
      itemPrice: product?.item?.price,
      priceWithDiscount: product?.price_with_discount ?? financialProduct?.price_with_discount,
      finalPrice: product?.final_price ?? financialProduct?.final_price,
      totalDiscountedPrice: product?.total_discounted_price ?? financialProduct?.total_discounted_price,
      actionsPrice: product?.actions_price ?? financialProduct?.actions_price,
      payout: product?.payout ?? financialProduct?.payout,
      itemFinancialData: product?.financial_data || null,
      postingFinancialProduct: financialProduct || null,
      commissionAmount:
        product?.commission_amount ??
        financialProduct?.commission_amount ??
        posting?.financial_data?.commission_amount
    };
  }

  function getNormalizedSalesDebug(product, normalized) {
    return {
      sku: normalized.sku,
      offerId: normalized.offerId,
      quantity: normalized.quantity,
      rawPrice: product?.price ?? product?.item?.price ?? null,
      normalizedRevenue: normalized.revenue,
      normalizedPrice: normalized.price
    };
  }

  function resolveRevenueAndPrice(product, quantity, financialProduct) {
    const totalCandidates = [
      product?.total_discounted_price,
      financialProduct?.total_discounted_price,
      product?.actions_price,
      financialProduct?.actions_price,
      product?.payout,
      financialProduct?.payout
    ]
      .map(normalizeMoney)
      .filter(value => value > 0);

    if (totalCandidates.length) {
      const revenue = totalCandidates[0];
      return {
        revenue: Number(revenue.toFixed(2)),
        price: quantity > 0 ? Number((revenue / quantity).toFixed(2)) : 0
      };
    }

    const unitCandidates = [
      product?.price,
      product?.item?.price,
      product?.price_with_discount,
      financialProduct?.price_with_discount,
      product?.final_price,
      financialProduct?.final_price,
      product?.item_price,
      financialProduct?.item_price,
      financialProduct?.price
    ]
      .map(normalizeMoney)
      .filter(value => value > 0);

    const unitPrice = unitCandidates[0] || 0;
    const revenue = unitPrice * quantity;
    return {
      revenue: Number(revenue.toFixed(2)),
      price: Number(unitPrice.toFixed(2))
    };
  }

  function normalizePostingProduct(product, posting, fallback = {}, debugLogger = null) {
    const quantity = toNumber(product.quantity || product.qty || 1) || 1;
    const financialProduct = findFinancialProduct(product, posting);
    if (debugLogger) {
      debugLogger(getRawSalesDebug(product, posting, financialProduct));
    }
    const resolved = resolveRevenueAndPrice(product, quantity, financialProduct);
    const normalized = {
      sku: String(product.sku || product.item?.sku || fallback.sku || ""),
      offerId: String(product.offer_id || product.offerId || fallback.offerId || ""),
      productName: String(product.name || product.product_name || product.item?.name || fallback.name || ""),
      quantity,
      price: resolved.price,
      revenue: resolved.revenue
    };
    if (debugLogger) {
      debugLogger(getNormalizedSalesDebug(product, normalized));
    }
    return normalized;
  }

  function normalizePostingSalesRows(item, scheme, debugLogger = null) {
    const date = formatDate(
      item.in_process_at ||
        item.created_at ||
        item.shipment_date ||
        item.delivering_date ||
        item.analytics_data?.delivery_date_begin
    );
    const postingNumber = item.posting_number || item.order_id || "";
    const status = item.status || "";
    const products = Array.isArray(item.products) ? item.products : [];
    const rawRegion = item.analytics_data?.region || item.analytics_data?.city || "";

    return products.map(product => {
      const normalized = normalizePostingProduct(product, item, {}, debugLogger);
      return {
        date,
        sku: normalized.sku,
        offerId: normalized.offerId,
        productName: normalized.productName,
        quantity: normalized.quantity,
        revenue: normalized.revenue,
        price: normalized.price,
        postingNumber,
        orderId: String(item.order_id || postingNumber || ""),
        status,
        scheme,
        region: rawRegion
      };
    });
  }

  async function getProductInfo(products) {
    if (!products.length) return [];

    const productIds = products
      .map(product => product.product_id)
      .filter(Boolean);

    const offerIds = products
      .map(product => product.offer_id)
      .filter(Boolean);

    const body = productIds.length
      ? { product_id: productIds }
      : { offer_id: offerIds };

    const data = await requestOzon("/v3/product/info/list", body);
    return data.result?.items || data.items || [];
  }

  async function getProducts(limit = 10) {
    const normalizedLimit = normalizeLimit(limit);
    const data = await requestOzon("/v3/product/list", {
      filter: {
        visibility: "ALL"
      },
      limit: normalizedLimit,
      last_id: ""
    });

    const products = data.result?.items || [];

    try {
      const detailedProducts = await getProductInfo(products);
      if (detailedProducts.length) {
        return detailedProducts.map(normalizeProduct);
      }
    } catch {}

    return products.map(normalizeProduct);
  }

  async function getStocks(limit = 100) {
    const normalizedLimit = normalizeLimit(limit);
    const normalized = await getNormalizedStockRows(normalizedLimit);
    let details = [];
    try {
      details = await getProducts(normalizedLimit);
    } catch {}
    const detailMaps = buildProductDetailMaps(
      details.map(item => ({
        product_id: item.productId,
        offer_id: item.offerId,
        sku: item.sku,
        price: item.price,
        name: item.name
      }))
    );
    return aggregateNormalizedStocks(normalized.rows, detailMaps);
  }

  async function getWarehouseList() {
    const data = await requestOzon("/v1/warehouse/list", {});
    return extractWarehouseList(data).map(normalizeWarehouseReference);
  }

  async function getNormalizedStockRows(limit = 1000) {
    const normalizedLimit = clampOzonLimit(limit, 1000);
    let details = [];
    try {
      details = await getProducts(normalizedLimit);
    } catch {}
    const detailMaps = buildProductDetailMaps(
      details.map(item => ({
        product_id: item.productId,
        offer_id: item.offerId,
        sku: item.sku,
        price: item.price,
        name: item.name
      }))
    );

    let warehouses = [];
    try {
      warehouses = await getWarehouseList();
    } catch {}
    const warehouseRefs = {
      byId: new Map(warehouses.filter(item => item.warehouseId).map(item => [item.warehouseId, item])),
      byName: new Map(
        warehouses
          .filter(item => item.warehouseName)
          .map(item => [String(item.warehouseName).trim().toLowerCase(), item])
      )
    };

    const rows = [];
    const endpointsUsed = [];

    try {
      const data = await requestOzon("/v4/product/info/stocks", {
        filter: { visibility: "ALL" },
        limit: normalizedLimit
      });
      endpointsUsed.push("/v4/product/info/stocks");
      for (const item of extractStockItemsFromV4(data)) {
        rows.push(normalizeStockRow(item, warehouseRefs, detailMaps, "/v4/product/info/stocks"));
      }
    } catch (error) {
      console.log("[ozon] v4 stocks fetch failed", {
        preview: safeBodyPreview(error?.message || error)
      });
    }

    if (!rows.length) {
      try {
        const data = await requestOzon("/v1/product/info/stocks-by-warehouse/fbs", {
          limit: normalizedLimit
        });
        endpointsUsed.push("/v1/product/info/stocks-by-warehouse/fbs");
        for (const item of extractStockItemsFromWarehouseResponse(data)) {
          rows.push(normalizeStockRow(item, warehouseRefs, detailMaps, "/v1/product/info/stocks-by-warehouse/fbs"));
        }
      } catch (error) {
        console.log("[ozon] fbs warehouse stocks fetch failed", {
          preview: safeBodyPreview(error?.message || error)
        });
      }
    }

    return {
      endpointUsed: endpointsUsed[0] || "none",
      endpointsUsed,
      rows
    };
  }

  async function getStocksDebugData(limit = 1000) {
    const normalized = await getNormalizedStockRows(limit);
    return {
      endpointUsed: normalized.endpointUsed,
      rowsCount: normalized.rows.length,
      rows: normalized.rows.slice(0, 20)
    };
  }

  async function getFinanceTransactions({ dateFrom, dateTo, page = 1, pageSize = 1000 }) {
    const data = await requestOzon("/v3/finance/transaction/list", {
      filter: {
        date: {
          from: dateFrom,
          to: dateTo
        },
        operation_type: [],
        posting_number: "",
        transaction_type: "all"
      },
      page,
      page_size: pageSize
    });

    return data.result || data;
  }

  function normalizeFinanceTransaction(item) {
    return {
      date: formatDate(
        item.operation_date ||
          item.transaction_date ||
          item.posting?.posting_date ||
          item.date ||
          new Date()
      ),
      operationType: String(item.operation_type || item.type || item.name || "").trim(),
      operationTypeName: String(item.operation_type_name || item.type_name || "").trim(),
      accrualsForSale: toNumber(item.accruals_for_sale),
      saleCommission: toNumber(item.sale_commission),
      amount: toNumber(item.amount),
      deliveryCharge: toNumber(item.delivery_charge),
      returnDeliveryCharge: toNumber(item.return_delivery_charge),
      services: Array.isArray(item.services) ? item.services : item.services ? [item.services] : [],
      raw: item
    };
  }

  function normalizeServiceEntry(service) {
    return {
      name: String(service?.name || service?.service_name || service?.title || service?.type || "").trim(),
      type: String(service?.type || service?.service_type || service?.code || "").trim(),
      amount: toNumber(service?.price ?? service?.amount ?? service?.sum ?? service?.value ?? 0)
    };
  }

  function isAdvertisingText(haystack) {
    return (
      haystack.includes("продвиж") ||
      haystack.includes("реклам") ||
      haystack.includes("оплата за клик") ||
      haystack.includes("ускоренный сбор отзывов") ||
      haystack.includes("отзыв") ||
      haystack.includes("бренд") ||
      haystack.includes("brand") ||
      haystack.includes("click") ||
      haystack.includes("advert") ||
      haystack.includes("promotion") ||
      haystack.includes("promo")
    );
  }

  function isPartnerServiceText(haystack) {
    return (
      haystack.includes("услуги партн") ||
      haystack.includes("партнер") ||
      haystack.includes("партн") ||
      haystack.includes("partner") ||
      haystack.includes("эквайринг") ||
      haystack.includes("acquiring") ||
      haystack.includes("обработка возвратов, отмен и невыкупов партн") ||
      haystack.includes("partner return processing") ||
      haystack.includes("упаковка товара партн") ||
      haystack.includes("package redistribution") ||
      haystack.includes("доставка до места выдачи партн") ||
      haystack.includes("partner delivery to pickup point")
    );
  }

  function isFboServiceText(haystack) {
    return (
      haystack.includes("услуги fbo") ||
      haystack.includes("fbo") ||
      haystack.includes("кросс-докинг") ||
      haystack.includes("crossdocking") ||
      (haystack.includes("размещени") && haystack.includes("склад")) ||
      haystack.includes("storage") ||
      (haystack.includes("дополнительная упаковка") && haystack.includes("склад")) ||
      haystack.includes("additional packaging at warehouse") ||
      haystack.includes("обработка срока годности") ||
      haystack.includes("expiration date processing") ||
      haystack.includes("обработка товара в составе грузоместа") ||
      haystack.includes("supply additional")
    );
  }

  function isLogisticsText(haystack) {
    return (
      haystack.includes("достав") ||
      haystack.includes("логист") ||
      haystack.includes("delivery") ||
      haystack.includes("logistic")
    );
  }

  function isCommissionText(haystack) {
    return (
      haystack.includes("комисс") ||
      haystack.includes("вознагражд") ||
      haystack.includes("commission")
    );
  }

  function classifyServiceBucket(service, transaction = null) {
    const hasOwnServiceText = Boolean(service?.name || service?.type);
    const haystack = hasOwnServiceText
      ? buildTextHaystack(service?.name, service?.type)
      : buildTextHaystack(
          service?.name,
          service?.type,
          transaction?.operationType,
          transaction?.operationTypeName
        );
    if (isAdvertisingText(haystack)) {
      return "advertising";
    }
    if (isPartnerServiceText(haystack)) {
      return "partnerServices";
    }
    if (isFboServiceText(haystack) || haystack.includes("fbo")) {
      return "fboServices";
    }
    if (isLogisticsText(haystack)) {
      return "logistics";
    }
    if (isCommissionText(haystack)) {
      return "ozonCommission";
    }
    
    return "otherServices";
  }

  function classifyTransactionAmount(transaction) {
    const haystack = buildTextHaystack(transaction.operationType, transaction.operationTypeName);
    if (
      haystack.includes("payout") ||
      haystack.includes("payment") ||
      haystack.includes("transfer") ||
      haystack.includes("accrued") ||
      haystack.includes("выплат") ||
      haystack.includes("перевод") ||
      haystack.includes("баланс")
    ) {
      return "otherServices";
    }

    if (isAdvertisingText(haystack)) {
      return "advertising";
    }
    if (isPartnerServiceText(haystack)) {
      return "partnerServices";
    }
    if (isFboServiceText(haystack) || haystack.includes("fbo")) {
      return "fboServices";
    }
    if (isLogisticsText(haystack)) {
      return "logistics";
    }
    if (isCommissionText(haystack)) {
      return "ozonCommission";
    }
    
    return "otherServices";
  }

  function createEmptyFinanceRow(date) {
    return {
      date,
      sales: 0,
      returns: 0,
      ozonCommission: 0,
      logistics: 0,
      partnerServices: 0,
      fboServices: 0,
      advertising: 0,
      otherServices: 0,
      accruedTotal: 0
    };
  }

  function aggregateFinanceFacts(transactions) {
    const byDate = new Map();
    const groupedTypes = new Map();
    const advertisingGroups = new Map();
    const partnerServiceEntries = [];
    const fboServiceEntries = [];
    let uncategorizedLogged = 0;

    const bucketMaps = {
      advertising: new Map(),
      ozonCommission: new Map(),
      partnerServices: new Map(),
      fboServices: new Map(),
      logistics: new Map(),
      otherServices: new Map()
    };

    for (const transaction of transactions.map(normalizeFinanceTransaction)) {
      const row = byDate.get(transaction.date) || createEmptyFinanceRow(transaction.date);
      row.accruedTotal += transaction.amount;

      if (transaction.accrualsForSale > 0) {
        row.sales += transaction.accrualsForSale;
      } else if (transaction.accrualsForSale < 0) {
        row.returns += transaction.accrualsForSale;
      }

      if (transaction.saleCommission !== 0) {
        row.ozonCommission += transaction.saleCommission;
        const commKey = [
          transaction.operationType || "-",
          transaction.operationTypeName || "-"
        ].join(" | ");
        const currentComm = bucketMaps.ozonCommission.get(commKey) || {
          key: commKey,
          totalAmount: 0,
          saleCommissionTotal: 0,
          accrualsForSaleTotal: 0,
          amountTotal: 0,
          servicesRemainderTotal: 0,
          count: 0
        };
        currentComm.totalAmount = Number((currentComm.totalAmount + transaction.saleCommission).toFixed(2));
        currentComm.saleCommissionTotal = Number((currentComm.saleCommissionTotal + transaction.saleCommission).toFixed(2));
        currentComm.accrualsForSaleTotal = Number((currentComm.accrualsForSaleTotal + transaction.accrualsForSale).toFixed(2));
        currentComm.amountTotal = Number((currentComm.amountTotal + transaction.amount).toFixed(2));
        
        const servicesSum = transaction.services
          .map(normalizeServiceEntry)
          .reduce((sum, s) => sum + s.amount, 0);
        const servicesRemainder = Number((
          transaction.amount -
          transaction.accrualsForSale -
          transaction.saleCommission -
          transaction.deliveryCharge -
          transaction.returnDeliveryCharge -
          servicesSum
        ).toFixed(2));
        currentComm.servicesRemainderTotal = Number((currentComm.servicesRemainderTotal + servicesRemainder).toFixed(2));
        currentComm.count += 1;
        bucketMaps.ozonCommission.set(commKey, currentComm);
      }

      if (transaction.deliveryCharge !== 0) {
        row.logistics += transaction.deliveryCharge;
        const logKey = [
          transaction.operationType || "-",
          transaction.operationTypeName || "-",
          "(deliveryCharge)"
        ].join(" | ");
        const currentLog = bucketMaps.logistics.get(logKey) || { key: logKey, totalAmount: 0 };
        currentLog.totalAmount = Number((currentLog.totalAmount + transaction.deliveryCharge).toFixed(2));
        bucketMaps.logistics.set(logKey, currentLog);
      }

      if (transaction.returnDeliveryCharge !== 0) {
        row.logistics += transaction.returnDeliveryCharge;
        const logKey = [
          transaction.operationType || "-",
          transaction.operationTypeName || "-",
          "(returnDeliveryCharge)"
        ].join(" | ");
        const currentLog = bucketMaps.logistics.get(logKey) || { key: logKey, totalAmount: 0 };
        currentLog.totalAmount = Number((currentLog.totalAmount + transaction.returnDeliveryCharge).toFixed(2));
        bucketMaps.logistics.set(logKey, currentLog);
      }

      let serviceAmountTotal = 0;
      for (const service of transaction.services.map(normalizeServiceEntry)) {
        if (!service.amount) {
          continue;
        }
        serviceAmountTotal += service.amount;
        const bucket = classifyServiceBucket(service, transaction);
        row[bucket] += service.amount > 0 ? -Math.abs(service.amount) : service.amount;
        const groupKey = [
          transaction.operationType || "-",
          transaction.operationTypeName || "-",
          service.name || "-"
        ].join(" | ");
        const bucketMap = bucketMaps[bucket];
        if (bucketMap) {
          const current = bucketMap.get(groupKey) || { key: groupKey, totalAmount: 0 };
          current.totalAmount = Number((current.totalAmount + service.amount).toFixed(2));
          bucketMap.set(groupKey, current);
        }
        if (bucket === "advertising") {
          const currentAd = advertisingGroups.get(groupKey) || { key: groupKey, totalAmount: 0 };
          currentAd.totalAmount = Number((currentAd.totalAmount + service.amount).toFixed(2));
          advertisingGroups.set(groupKey, currentAd);
        }
        if (bucket === "partnerServices") {
          partnerServiceEntries.push({
            operationType: transaction.operationType,
            operationTypeName: transaction.operationTypeName,
            serviceName: service.name,
            serviceType: service.type,
            amount: Number(service.amount.toFixed(2)),
            bucket
          });
        }
        if (bucket === "fboServices") {
          fboServiceEntries.push({
            operationType: transaction.operationType,
            operationTypeName: transaction.operationTypeName,
            serviceName: service.name,
            serviceType: service.type,
            amount: Number(service.amount.toFixed(2)),
            bucket
          });
        }
      }

      const remainderAmount =
        transaction.amount -
        transaction.accrualsForSale -
        transaction.saleCommission -
        transaction.deliveryCharge -
        transaction.returnDeliveryCharge -
        serviceAmountTotal;

      if (Math.abs(remainderAmount) > 0.0001) {
        const bucket = classifyTransactionAmount(transaction);
        row[bucket] += remainderAmount;

        const groupKey = [
          transaction.operationType || "-",
          transaction.operationTypeName || "-",
          "(remainder)"
        ].join(" | ");
        const bucketMap = bucketMaps[bucket];
        if (bucketMap) {
          const current = bucketMap.get(groupKey) || { key: groupKey, totalAmount: 0 };
          current.totalAmount = Number((current.totalAmount + remainderAmount).toFixed(2));
          bucketMap.set(groupKey, current);
        }
        if (bucket === "advertising") {
          const currentAd = advertisingGroups.get(groupKey) || { key: groupKey, totalAmount: 0 };
          currentAd.totalAmount = Number((currentAd.totalAmount + remainderAmount).toFixed(2));
          advertisingGroups.set(groupKey, currentAd);
        }

        if (bucket === "otherServices" && uncategorizedLogged < 5) {
          uncategorizedLogged += 1;
          console.log("[ozon] finance uncategorized", {
            date: transaction.date,
            operationType: transaction.operationType,
            operationTypeName: transaction.operationTypeName,
            amount: transaction.amount,
            remainderAmount,
            services: transaction.services.map(service => service?.name || service?.service_name || service?.type || "")
          });
        }
      }

      const groupKey = [
        transaction.operationType || "-",
        transaction.operationTypeName || "-"
      ].join(" | ");
      const currentGroup = groupedTypes.get(groupKey) || { key: groupKey, count: 0, totalAmount: 0 };
      currentGroup.count += 1;
      currentGroup.totalAmount = Number((currentGroup.totalAmount + transaction.amount).toFixed(2));
      groupedTypes.set(groupKey, currentGroup);
      byDate.set(transaction.date, row);
    }

    // Calculate total candidate sums for date range
    const totalCommissionCandidate = Number(Array.from(bucketMaps.ozonCommission.values()).reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2));
    const totalPartnerCandidate = Number(Array.from(bucketMaps.partnerServices.values()).reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2));
    const totalFboCandidate = Number(Array.from(bucketMaps.fboServices.values()).reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2));
    const totalOtherCandidate = Number(Array.from(bucketMaps.otherServices.values()).reduce((sum, item) => sum + item.totalAmount, 0).toFixed(2));

    return {
      rows: Array.from(byDate.values())
        .sort((left, right) => left.date.localeCompare(right.date))
        .map(item => ({
          ...item,
          sales: Number(item.sales.toFixed(2)),
          returns: Number(item.returns.toFixed(2)),
          ozonCommission: Number(item.ozonCommission.toFixed(2)),
          logistics: Number(item.logistics.toFixed(2)),
          partnerServices: Number(item.partnerServices.toFixed(2)),
          fboServices: Number(item.fboServices.toFixed(2)),
          advertising: Number(item.advertising.toFixed(2)),
          otherServices: Number(item.otherServices.toFixed(2)),
          accruedTotal: Number(item.accruedTotal.toFixed(2))
        })),
      groupedOperations: Array.from(groupedTypes.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount)),
      advertisingGroups: Array.from(advertisingGroups.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount)),
      commissionGroups: Array.from(bucketMaps.ozonCommission.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount)),
      partnerServicesGroups: Array.from(bucketMaps.partnerServices.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount)),
      fboServicesGroups: Array.from(bucketMaps.fboServices.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount)),
      otherServicesGroups: Array.from(bucketMaps.otherServices.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount)),
      reconciliation: {
        commission: totalCommissionCandidate,
        partnerServices: totalPartnerCandidate,
        fboServices: totalFboCandidate,
        other: totalOtherCandidate
      },
      partnerServiceEntries,
      fboServiceEntries
    };
  }

  async function getFinanceFacts({ dateFrom, dateTo, pageSize = 1000, maxPages = 20 }) {
    const transactions = [];
    const safePageSize = Math.min(Math.max(Number(pageSize) || 1000, 1), 1000);

    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await getFinanceTransactions({
          dateFrom,
          dateTo,
          page,
          pageSize: safePageSize
        });
        const operations = result.operations || result.items || [];
        console.log("[ozon] finance fetch page", {
          dateFrom,
          dateTo,
          page,
          pageSize: safePageSize,
          rowsFetched: operations.length
        });
        transactions.push(...operations);
        const hasMore =
          Boolean(result.has_next_page) ||
          Boolean(result.hasNextPage) ||
          operations.length === safePageSize;
        if (!hasMore || !operations.length) {
          break;
        }
      }

      const aggregated = aggregateFinanceFacts(transactions);
      return {
        rows: aggregated.rows,
        diagnostics: {
          advertisingGroups: aggregated.advertisingGroups,
          commissionGroups: aggregated.commissionGroups,
          partnerServicesGroups: aggregated.partnerServicesGroups,
          fboServicesGroups: aggregated.fboServicesGroups,
          logisticsGroups: aggregated.logisticsGroups,
          otherServicesGroups: aggregated.otherServicesGroups,
          partnerServiceEntries: aggregated.partnerServiceEntries,
          fboServiceEntries: aggregated.fboServiceEntries,
          groupedOperations: aggregated.groupedOperations,
          reconciliation: aggregated.reconciliation,
          transactionCount: transactions.length
        },
        summary: {
          rows: aggregated.rows.length,
          transactionCount: transactions.length,
          accruedTotal: Number(
            aggregated.rows.reduce((sum, row) => sum + row.accruedTotal, 0).toFixed(2)
          )
        }
      };
    } catch (error) {
      error.userMessage = normalizeOzonError(error);
      throw error;
    }
  }

  async function getFboPostings({ dateFrom, dateTo, cursor = "", limit = 100 }) {
    const safeLimit = clampOzonLimit(limit, 100);
    const data = await requestOzon("/v3/posting/fbo/list", {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo
      },
      limit: safeLimit,
      cursor,
      with: {
        analytics_data: true,
        financial_data: true
      }
    });

    const result = data.result || data;
    const postings = result.postings || result.items || [];
    return {
      postings,
      has_next: Boolean(result.has_next),
      cursor: result.cursor || "",
      limit: safeLimit
    };
  }

  async function getFbsPostings({ dateFrom, dateTo, offset = 0, limit = 100 }) {
    const safeLimit = clampOzonLimit(limit, 100);
    const data = await requestOzon("/v3/posting/fbs/list", {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo
      },
      limit: safeLimit,
      offset,
      with: {
        analytics_data: true,
        financial_data: true
      }
    });

    const result = data.result || data;
    const postings = result.postings || result.items || [];
    return {
      postings,
      has_next: Boolean(result.has_next),
      offset: offset + postings.length,
      limit: safeLimit
    };
  }

  async function getSalesFacts({ dateFrom, dateTo, limit = 100, maxPages = 50, maxRows = 5000 }) {
    const safeLimit = clampOzonLimit(limit, 100);
    const salesRows = [];
    const seenPostingIds = new Set();
    const seenPageSignatures = new Set();
    let safetyStopped = false;
    let stopReason = "";
    let debugLoggedItems = 0;

    function debugSalesItem(rawItem) {
      if (debugLoggedItems >= 3) {
        return;
      }
      debugLoggedItems += 1;
      console.log("[ozon] sales raw item", rawItem);
    }

    function buildResult() {
      const uniqueSkus = new Set(salesRows.map(row => row.sku).filter(Boolean)).size;
      const totalRevenue = Number(
        salesRows.reduce((sum, row) => sum + toNumber(row.revenue), 0).toFixed(2)
      );
      const totalQuantity = Number(
        salesRows.reduce((sum, row) => sum + toNumber(row.quantity), 0).toFixed(2)
      );

      return {
        rows: salesRows,
        summary: {
          rows: salesRows.length,
          uniqueSkus,
          totalRevenue,
          totalQuantity
        },
        warning: safetyStopped ? "Sales fetch stopped by pagination safety guard." : "",
        stopReason
      };
    }

    function registerPage({ postings, scheme, page, offset = "", cursor = "" }) {
      const pageSignature = getPageSignature(postings);
      const ids = postings.map(getPostingIdentity).filter(Boolean);
      const firstPostingId = ids[0] || "";
      const lastPostingId = ids[ids.length - 1] || "";
      let uniqueRowsAdded = 0;

      if (postings.length) {
        if (seenPageSignatures.has(pageSignature)) {
          safetyStopped = true;
          stopReason = "repeated_page_signature";
        } else {
          seenPageSignatures.add(pageSignature);
        }
      }

      if (!safetyStopped) {
        for (const item of postings) {
          const postingId = getPostingIdentity(item);
          if (postingId && seenPostingIds.has(postingId)) {
            continue;
          }
          if (postingId) {
            seenPostingIds.add(postingId);
          }
          const normalizedRows = normalizePostingSalesRows(item, scheme, debugSalesItem);
          salesRows.push(...normalizedRows);
          uniqueRowsAdded += normalizedRows.length;
        }
      }

      if (!safetyStopped && postings.length && uniqueRowsAdded === 0) {
        safetyStopped = true;
        stopReason = "duplicate_page";
      }

      console.log("[ozon] sales fetch page", {
        scheme,
        page,
        offset,
        cursor,
        rowsFetched: postings.length,
        firstPostingId,
        lastPostingId,
        uniqueRowsAdded,
        totalRowsAccumulated: salesRows.length,
        stopReason: stopReason || ""
      });

      return {
        firstPostingId,
        lastPostingId,
        uniqueRowsAdded
      };
    }

    try {
      let fboCursor = "";
      let page = 1;
      let hasNextFbo = true;
      let previousFboBoundary = "";
      while (hasNextFbo) {
        if (salesRows.length >= maxRows) {
          safetyStopped = true;
          stopReason = "max_rows";
          break;
        }
        if (page > maxPages) {
          safetyStopped = true;
          stopReason = "max_pages";
          break;
        }
        console.log("[ozon] sales fetch FBO", {
          dateFrom,
          dateTo,
          limit: safeLimit,
          page,
          cursor: fboCursor || ""
        });
        const fbo = await getFboPostings({ dateFrom, dateTo, cursor: fboCursor, limit: safeLimit });
        const details = registerPage({
          postings: fbo.postings,
          scheme: "FBO",
          page,
          cursor: fboCursor || ""
        });
        if (safetyStopped || !fbo.postings.length) {
          break;
        }
        const boundarySignature = details.firstPostingId + "|" + details.lastPostingId;
        if (boundarySignature && boundarySignature === previousFboBoundary) {
          safetyStopped = true;
          stopReason = "repeated_boundary";
          break;
        }
        previousFboBoundary = boundarySignature;
        hasNextFbo = Boolean(
          fbo.postings.length === safeLimit &&
            fbo.has_next !== false
        );
        fboCursor = fbo.cursor || "";
        page += 1;
      }

      let hasNextFbs = true;
      let fbsPage = 1;
      let previousFbsBoundary = "";
      while (hasNextFbs && !safetyStopped) {
        if (salesRows.length >= maxRows) {
          safetyStopped = true;
          stopReason = "max_rows";
          break;
        }
        if (fbsPage > maxPages) {
          safetyStopped = true;
          stopReason = "max_pages";
          break;
        }
        const offset = (fbsPage - 1) * safeLimit;
        console.log("[ozon] sales fetch FBS", {
          dateFrom,
          dateTo,
          limit: safeLimit,
          page: fbsPage,
          offset
        });
        const fbs = await getFbsPostings({ dateFrom, dateTo, offset, limit: safeLimit });
        const details = registerPage({
          postings: fbs.postings,
          scheme: "FBS",
          page: fbsPage,
          offset
        });
        if (safetyStopped || !fbs.postings.length) {
          break;
        }
        const boundarySignature = details.firstPostingId + "|" + details.lastPostingId;
        if (boundarySignature && boundarySignature === previousFbsBoundary) {
          safetyStopped = true;
          stopReason = "repeated_boundary";
          break;
        }
        previousFbsBoundary = boundarySignature;
        hasNextFbs = Boolean(fbs.postings.length === safeLimit && fbs.has_next !== false);
        fbsPage += 1;
      }

      if (stopReason) {
        console.log("[ozon] sales fetch stopped", {
          stopReason,
          totalRowsAccumulated: salesRows.length
        });
      }

      return buildResult();
    } catch (error) {
      error.userMessage = normalizeOzonError(error);
      throw error;
    }
  }

  return {
    getFboPostings,
    getFbsPostings,
    getFinanceFacts,
    getFinanceTransactions,
    getNormalizedStockRows,
    getProducts,
    getSalesFacts,
    getStocks,
    getStocksDebugData,
    getWarehouseList,
    getCityForWarehouse
  };
}

module.exports = {
  getPageSignature,
  getPostingIdentity,
  clampOzonLimit,
  createOzonService
};
