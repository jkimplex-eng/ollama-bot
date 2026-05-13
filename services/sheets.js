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

    return response.text();
  }

  return {
    addRow
  };
}

module.exports = {
  createSheetsService
};
