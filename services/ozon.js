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

function createOzonService({ clientId, apiKey }) {
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

    const data = await response.json();

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

  function getStock(product) {
    const stocks = product.stocks;

    if (Array.isArray(stocks)) {
      const total = stocks.reduce((sum, item) => {
        const value = item.present ?? item.stock ?? item.available ?? 0;
        return sum + Number(value || 0);
      }, 0);

      return total;
    }

    if (typeof stocks === "number") return stocks;
    if (!stocks || typeof stocks !== "object") return "";
    if (typeof stocks.present === "number") return stocks.present;
    if (typeof stocks.stock === "number") return stocks.stock;
    if (typeof stocks.available === "number") return stocks.available;

    return "";
  }

  function normalizeProduct(product) {
    return {
      name: product.name ?? product.title ?? "",
      sku: product.sku ?? product.offer_id ?? product.product_id ?? "",
      price: product.price ?? product.marketing_price ?? product.old_price ?? "",
      stock: getStock(product),
      productId: product.product_id ?? product.id ?? "",
      offerId: product.offer_id ?? ""
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
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizePostingProduct(product, fallback = {}) {
    const quantity = toNumber(product.quantity || product.qty || 1) || 1;
    const price = toNumber(
      product.price ||
        product.price_with_discount ||
        product.payout ||
        product.item_price ||
        0
    );

    return {
      sku: String(product.sku || product.item?.sku || fallback.sku || ""),
      offerId: String(product.offer_id || product.offerId || fallback.offerId || ""),
      productName: String(product.name || product.product_name || product.item?.name || fallback.name || ""),
      quantity,
      price,
      revenue: Number((price * quantity).toFixed(2))
    };
  }

  function normalizePostingSalesRows(item, scheme) {
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
      const normalized = normalizePostingProduct(product);
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
          const normalizedRows = normalizePostingSalesRows(item, scheme);
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
    getFinanceTransactions,
    getProducts,
    getSalesFacts,
    getStocks
  };
}

module.exports = {
  getPageSignature,
  getPostingIdentity,
  clampOzonLimit,
  createOzonService
};
