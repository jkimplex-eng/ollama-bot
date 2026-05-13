function createOzonService({ clientId, apiKey }) {
  async function getProducts() {
    if (!clientId || !apiKey) {
      throw new Error("OZON_CLIENT_ID или OZON_API_KEY не найден в .env");
    }

    const response = await fetch("https://api-seller.ozon.ru/v3/product/list", {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: {
          visibility: "ALL"
        },
        limit: 10,
        last_id: ""
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    return data.result?.items || [];
  }

  return {
    getProducts
  };
}

module.exports = {
  createOzonService
};
