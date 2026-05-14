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

  async function getFboPostings({ dateFrom, dateTo, lastId = "", limit = 1000 }) {
    const data = await requestOzon("/v3/posting/fbo/list", {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo
      },
      limit,
      offset: 0,
      with: {
        analytics_data: true,
        financial_data: true
      }
    });

    const result = data.result || data;
    return {
      postings: result.postings || result.items || [],
      has_next: Boolean(result.has_next),
      last_id: lastId
    };
  }

  async function getFbsPostings({ dateFrom, dateTo, lastId = "", limit = 1000 }) {
    const data = await requestOzon("/v3/posting/fbs/list", {
      dir: "ASC",
      filter: {
        since: dateFrom,
        to: dateTo
      },
      limit,
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
      last_id: result.last_id || ""
    };
  }

  return {
    getFboPostings,
    getFbsPostings,
    getFinanceTransactions,
    getProducts,
    getStocks
  };
}

module.exports = {
  createOzonService
};
