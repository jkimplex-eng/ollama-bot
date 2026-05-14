function createSheetsService({ webappUrl }) {
  async function addRow(sheet, row) {
    if (!webappUrl) {
      throw new Error("GOOGLE_SHEETS_WEBAPP_URL не найден в .env");
    }

    const response = await fetch(webappUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheet,
        row
      })
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(text || "Google Sheets вернул ошибку: " + response.status);
    }

    return text;
  }

  async function addRows(sheet, rows) {
    for (const row of rows) {
      await addRow(sheet, row);
    }
  }

  return {
    addRow,
    addRows
  };
}

module.exports = {
  createSheetsService
};
