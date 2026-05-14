const { getSheetMapping } = require("../config/sheetsMap");

const CHUNK_SIZE = 100;

function normalizeRows(rows, columnCount) {
  return rows.map(row => {
    const values = Array.isArray(row) ? [...row] : [];

    if (values.length > columnCount) {
      throw new Error(
        "Row length validation failed: expected " +
          columnCount +
          " columns, got " +
          values.length
      );
    }

    while (values.length < columnCount) {
      values.push("");
    }

    return values;
  });
}

function chunkRows(rows, chunkSize = CHUNK_SIZE) {
  const result = [];

  for (let index = 0; index < rows.length; index += chunkSize) {
    result.push(rows.slice(index, index + chunkSize));
  }

  return result;
}

function parseAppsScriptError(text, tabName) {
  if (!text) {
    return "Google Sheets returned an empty error response.";
  }

  if (/^\s*</.test(text)) {
    return (
      "Google Sheets Apps Script returned HTML instead of JSON. " +
      "Check deployment permissions or script errors for tab `" +
      tabName +
      "`."
    );
  }

  try {
    const data = JSON.parse(text);
    const message = data.error || data.message || data.details || text;

    if (String(message).includes("Sheet tab not found:")) {
      return String(message);
    }

    return String(message);
  } catch {
    return text;
  }
}

function createSheetsService({ webappUrl }) {
  function ensureConfigured() {
    if (!webappUrl) {
      throw new Error("GOOGLE_SHEETS_WEBAPP_URL не найден в .env");
    }
  }

  async function postAction(payload, tabName) {
    ensureConfigured();

    const response = await fetch(webappUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(parseAppsScriptError(text, tabName));
    }

    if (/^\s*</.test(text)) {
      throw new Error(parseAppsScriptError(text, tabName));
    }

    try {
      return text ? JSON.parse(text) : { ok: true };
    } catch {
      return { ok: true, raw: text };
    }
  }

  function prepareRows(mappingKey, rows) {
    const mapping = getSheetMapping(mappingKey);
    const normalizedRows = normalizeRows(rows, mapping.columns.length);
    return { mapping, normalizedRows };
  }

  async function appendMappedRows(mappingKey, rows) {
    const { mapping, normalizedRows } = prepareRows(mappingKey, rows);

    for (const chunk of chunkRows(normalizedRows)) {
      const result = await postAction(
        {
          action: "appendRows",
          sheet: mapping.tabName,
          rows: chunk
        },
        mapping.tabName
      );

      if (result && result.ok === false) {
        throw new Error(parseAppsScriptError(JSON.stringify(result), mapping.tabName));
      }
    }

    return {
      mappingKey,
      tabName: mapping.tabName,
      rowsWritten: normalizedRows.length
    };
  }

  async function replaceMappedRows(mappingKey, rows) {
    const { mapping, normalizedRows } = prepareRows(mappingKey, rows);
    const chunks = chunkRows(normalizedRows);

    if (!chunks.length) {
      await postAction(
        {
          action: "replaceRows",
          sheet: mapping.tabName,
          headers: mapping.columns,
          rows: []
        },
        mapping.tabName
      );

      return {
        mappingKey,
        tabName: mapping.tabName,
        rowsWritten: 0
      };
    }

    await postAction(
      {
        action: "replaceRows",
        sheet: mapping.tabName,
        headers: mapping.columns,
        rows: chunks[0]
      },
      mapping.tabName
    );

    for (let index = 1; index < chunks.length; index += 1) {
      await postAction(
        {
          action: "appendRows",
          sheet: mapping.tabName,
          rows: chunks[index]
        },
        mapping.tabName
      );
    }

    return {
      mappingKey,
      tabName: mapping.tabName,
      rowsWritten: normalizedRows.length
    };
  }

  async function clearAndWriteMappedRows(mappingKey, rows) {
    const { mapping, normalizedRows } = prepareRows(mappingKey, rows);
    const chunks = chunkRows(normalizedRows);

    await postAction(
      {
        action: "clearAndWrite",
        sheet: mapping.tabName,
        headers: mapping.columns,
        rows: chunks[0] || []
      },
      mapping.tabName
    );

    for (let index = 1; index < chunks.length; index += 1) {
      await postAction(
        {
          action: "appendRows",
          sheet: mapping.tabName,
          rows: chunks[index]
        },
        mapping.tabName
      );
    }

    return {
      mappingKey,
      tabName: mapping.tabName,
      rowsWritten: normalizedRows.length
    };
  }

  async function addRow(mappingKey, row) {
    return appendMappedRows(mappingKey, [row]);
  }

  async function addRows(mappingKey, rows) {
    return appendMappedRows(mappingKey, rows);
  }

  return {
    addRow,
    addRows,
    appendMappedRows,
    clearAndWriteMappedRows,
    replaceMappedRows
  };
}

module.exports = {
  chunkRows,
  createSheetsService,
  normalizeRows,
  parseAppsScriptError
};
