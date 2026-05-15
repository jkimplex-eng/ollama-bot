const sheetsMap = {
  products: {
    logicalName: "products",
    tabName: "Products",
    columns: ["Название", "SKU", "Offer ID", "Цена", "Остаток"],
    mode: "replace"
  },
  stocks: {
    logicalName: "stocks",
    tabName: "Stocks",
    columns: ["Название", "SKU", "Offer ID", "Остаток"],
    mode: "replace"
  },
  performance_campaigns: {
    logicalName: "performance_campaigns",
    tabName: "Performance Campaigns",
    columns: [
      "Campaign ID",
      "Campaign Name",
      "State",
      "Adv Object Type",
      "Payment Type",
      "From Date",
      "To Date",
      "Budget",
      "Daily Budget",
      "Weekly Budget",
      "Placement",
      "Product Campaign Mode",
      "Created At",
      "Updated At"
    ],
    mode: "replace"
  },
  performance_stats: {
    logicalName: "performance_stats",
    tabName: "Performance Stats",
    columns: [
      "Date",
      "Campaign ID",
      "Campaign Name",
      "SKU",
      "Product Name",
      "Price",
      "Impressions",
      "Clicks",
      "CTR",
      "Add To Cart",
      "Avg CPC",
      "Avg CPM",
      "Spend",
      "Orders",
      "Revenue",
      "Model Orders",
      "Model Revenue",
      "DRR"
    ],
    mode: "replace"
  },
  daily_summary: {
    logicalName: "daily_summary",
    tabName: "Daily Summary",
    columns: [
      "Дата",
      "Выручка",
      "Выплата Ozon",
      "Заказы",
      "Комиссия",
      "Логистика",
      "Реклама",
      "Себестоимость",
      "Прибыль",
      "Маржа",
      "ДРР"
    ],
    mode: "append"
  },
  alerts: {
    logicalName: "alerts",
    tabName: "Alerts",
    columns: ["Дата", "Уровень", "Тип", "Сообщение"],
    mode: "append"
  },
  daily_sku: {
    logicalName: "daily_sku",
    tabName: "Daily SKU",
    columns: ["Дата", "SKU", "Offer ID", "Название", "Количество", "Выручка"],
    mode: "append"
  },
  daily_history: {
    logicalName: "daily_history",
    tabName: "PL History",
    columns: [
      "Дата",
      "Выручка",
      "Выплата Ozon",
      "Заказы",
      "Финансовые транзакции",
      "Отправления",
      "Прибыль",
      "Warnings"
    ],
    mode: "append"
  },
  finance_raw: {
    logicalName: "finance_raw",
    tabName: "Finance Raw",
    columns: [
      "Дата отчёта",
      "Дата операции",
      "operation_type",
      "operation_type_name",
      "accruals_for_sale",
      "sale_commission",
      "amount",
      "delivery_charge",
      "return_delivery_charge",
      "services",
      "posting_number",
      "sku",
      "offer_id",
      "item_name"
    ],
    mode: "append"
  },
  orders_raw: {
    logicalName: "orders_raw",
    tabName: "Orders Raw",
    columns: [
      "Дата отчёта",
      "Дата отправления",
      "Схема",
      "posting_number",
      "status",
      "sku",
      "offer_id",
      "item_name",
      "quantity",
      "price",
      "gross_revenue"
    ],
    mode: "append"
  },
  pl_diagnostics: {
    logicalName: "pl_diagnostics",
    tabName: "PL Diagnostics",
    columns: [
      "Дата отчёта",
      "Дата от",
      "Дата до",
      "Таймзона",
      "finance_transactions",
      "postings",
      "revenue",
      "orders",
      "payout",
      "profit_calculated",
      "warnings"
    ],
    mode: "append"
  }
};

function getSheetMapping(mappingKey) {
  const mapping = sheetsMap[mappingKey];

  if (!mapping) {
    throw new Error("Unknown sheet mapping: " + mappingKey);
  }

  return mapping;
}

module.exports = {
  getSheetMapping,
  sheetsMap
};
