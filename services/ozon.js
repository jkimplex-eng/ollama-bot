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
        scheme
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
    const data = await requestOzon("/v3/product/info/stocks", {
      filter: {
        visibility: "ALL"
      },
      limit: normalizedLimit
    });

    const stocks = data.result?.items || data.items || [];
    let details = [];

    try {
      details = await getProductInfo(stocks);
    } catch {}

    const detailsByProductId = new Map(
      details
        .filter(product => product.product_id !== undefined && product.product_id !== null)
        .map(product => [String(product.product_id), product])
    );
    const detailsByOfferId = new Map(
      details
        .filter(product => product.offer_id !== undefined && product.offer_id !== null)
        .map(product => [String(product.offer_id), product])
    );

    return stocks.map(stock => normalizeStock(stock, detailsByProductId, detailsByOfferId));
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
      amount: toNumber(service?.price ?? service?.amount ?? service?.sum ?? service?.value ?? 0)
    };
  }

  function classifyServiceBucket(name) {
    const haystack = buildTextHaystack(name);
    if (
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
    ) {
      return "advertising";
    }
    if (haystack.includes("партнер") || haystack.includes("партн") || haystack.includes("partner")) {
      return "partnerServices";
    }
    if (haystack.includes("fbo")) {
      return "fboServices";
    }
    if (haystack.includes("достав") || haystack.includes("логист") || haystack.includes("delivery") || haystack.includes("logistic")) {
      return "logistics";
    }
    if (haystack.includes("комисс") || haystack.includes("вознагражд") || haystack.includes("commission")) {
      return "ozonCommission";
    }
    return "otherServices";
  }

  function classifyTransactionAmount(transaction) {
    const haystack = buildTextHaystack(transaction.operationType, transaction.operationTypeName);
    if (
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
    ) {
      return "advertising";
    }
    if (haystack.includes("партнер") || haystack.includes("партн") || haystack.includes("partner")) {
      return "partnerServices";
    }
    if (haystack.includes("fbo")) {
      return "fboServices";
    }
    if (haystack.includes("достав") || haystack.includes("логист") || haystack.includes("delivery") || haystack.includes("logistic")) {
      return "logistics";
    }
    if (haystack.includes("комисс") || haystack.includes("вознагражд") || haystack.includes("commission")) {
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
    let uncategorizedLogged = 0;

    for (const transaction of transactions.map(normalizeFinanceTransaction)) {
      const row = byDate.get(transaction.date) || createEmptyFinanceRow(transaction.date);
      row.accruedTotal += transaction.amount;

      if (transaction.accrualsForSale > 0) {
        row.sales += transaction.accrualsForSale;
      } else if (transaction.accrualsForSale < 0) {
        row.returns += transaction.accrualsForSale;
      }

      if (transaction.saleCommission !== 0) {
        row.ozonCommission += -Math.abs(transaction.saleCommission);
      }

      if (transaction.deliveryCharge !== 0) {
        row.logistics += -Math.abs(transaction.deliveryCharge);
      }

      if (transaction.returnDeliveryCharge !== 0) {
        row.logistics += -Math.abs(transaction.returnDeliveryCharge);
      }

      let serviceAmountTotal = 0;
      for (const service of transaction.services.map(normalizeServiceEntry)) {
        if (!service.amount) {
          continue;
        }
        serviceAmountTotal += service.amount;
        const bucket = classifyServiceBucket(service.name);
        row[bucket] += service.amount > 0 ? -Math.abs(service.amount) : service.amount;
        if (bucket === "advertising") {
          const adKey = [
            transaction.operationType || "-",
            transaction.operationTypeName || "-",
            service.name || "-"
          ].join(" | ");
          const currentAd = advertisingGroups.get(adKey) || { key: adKey, totalAmount: 0 };
          currentAd.totalAmount = Number((currentAd.totalAmount + service.amount).toFixed(2));
          advertisingGroups.set(adKey, currentAd);
        }
      }

      const remainderAmount =
        transaction.amount -
        transaction.accrualsForSale -
        (transaction.saleCommission !== 0 ? -Math.abs(transaction.saleCommission) : 0) -
        (transaction.deliveryCharge !== 0 ? -Math.abs(transaction.deliveryCharge) : 0) -
        (transaction.returnDeliveryCharge !== 0 ? -Math.abs(transaction.returnDeliveryCharge) : 0) -
        serviceAmountTotal;

      if (Math.abs(remainderAmount) > 0.0001) {
        const bucket = classifyTransactionAmount(transaction);
        row[bucket] += remainderAmount;
        if (bucket === "advertising") {
          const adKey = [
            transaction.operationType || "-",
            transaction.operationTypeName || "-",
            "(transaction)"
          ].join(" | ");
          const currentAd = advertisingGroups.get(adKey) || { key: adKey, totalAmount: 0 };
          currentAd.totalAmount = Number((currentAd.totalAmount + remainderAmount).toFixed(2));
          advertisingGroups.set(adKey, currentAd);
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
      advertisingGroups: Array.from(advertisingGroups.values()).sort((left, right) => Math.abs(right.totalAmount) - Math.abs(left.totalAmount))
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
          groupedOperations: aggregated.groupedOperations,
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

  async function getFboPostings({ dateFrom, dateTo, offset = 0, limit = 100 }) {
    const safeLimit = clampOzonLimit(limit, 100);
    const data = await requestOzon("/v3/posting/fbo/list", {
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

  async function getFbsPostings({ dateFrom, dateTo, lastId = "", limit = 100 }) {
    const safeLimit = clampOzonLimit(limit, 100);
    const data = await requestOzon("/v3/posting/fbs/list", {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo
      },
      limit: safeLimit,
      last_id: lastId,
      with: {
        analytics_data: true,
        financial_data: true
      }
    });

    const result = data.result || data;
    return {
      postings: result.postings || result.items || [],
      has_next: Boolean(result.has_next),
      last_id: result.last_id || "",
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
      let offset = 0;
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
          offset
        });
        const fbo = await getFboPostings({ dateFrom, dateTo, offset, limit: safeLimit });
        const details = registerPage({
          postings: fbo.postings,
          scheme: "FBO",
          page,
          offset
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
        hasNextFbo = Boolean(fbo.postings.length === safeLimit && fbo.has_next !== false);
        offset += fbo.postings.length;
        page += 1;
      }

      let lastId = "";
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
        console.log("[ozon] sales fetch FBS", {
          dateFrom,
          dateTo,
          limit: safeLimit,
          page: fbsPage,
          cursor: lastId || ""
        });
        const fbs = await getFbsPostings({ dateFrom, dateTo, lastId, limit: safeLimit });
        const details = registerPage({
          postings: fbs.postings,
          scheme: "FBS",
          page: fbsPage,
          cursor: lastId || ""
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
        hasNextFbs = Boolean(
          fbs.postings.length === safeLimit &&
            fbs.has_next &&
            fbs.last_id &&
            fbs.last_id !== lastId
        );
        lastId = fbs.last_id || "";
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
    getProducts,
    getSalesFacts,
    getStocks,
    getCityForWarehouse
  };
}

module.exports = {
  getPageSignature,
  getPostingIdentity,
  clampOzonLimit,
  createOzonService
};
