const { getSheetMapping } = require("../config/sheetsMap");

const CHUNK_SIZE = 100;
const DEFAULT_FORMATTING = {
  boldHeader: true,
  freezeRows: 1,
  autoResizeColumns: true,
  headerBackground: "#000000",
  headerFontColor: "#ffffff",
  currencyColumns: [],
  percentColumns: [],
  conditionalColumns: []
};

function mergeFormatting(baseFormatting, overrideFormatting) {
  const base = baseFormatting || {};
  const override = overrideFormatting || {};

  return {
    ...base,
    ...override,
    currencyColumns: override.currencyColumns ?? base.currencyColumns ?? [],
    percentColumns: override.percentColumns ?? base.percentColumns ?? [],
    conditionalColumns: override.conditionalColumns ?? base.conditionalColumns ?? [],
    currencyRows: override.currencyRows ?? base.currencyRows ?? [],
    percentRows: override.percentRows ?? base.percentRows ?? [],
    conditionalRows: override.conditionalRows ?? base.conditionalRows ?? []
  };
}

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

function resolveSheetName(mapping, options = {}) {
  return options.sheetName || mapping.tabName;
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

  function prepareRows(mappingKey, rows, options = {}) {
    const mapping = getSheetMapping(mappingKey);
    const sheetName = resolveSheetName(mapping, options);
    const headers = Array.isArray(options.headers) && options.headers.length
      ? options.headers
      : mapping.columns;
    const normalizedRows = normalizeRows(rows, headers.length);
    const formatting = options.formatting === false
      ? null
      : mergeFormatting(mergeFormatting(DEFAULT_FORMATTING, mapping.formatting), options.formatting);
    return { mapping, normalizedRows, headers, formatting, sheetName };
  }

  async function appendMappedRows(mappingKey, rows, options = {}) {
    const { mapping, normalizedRows, sheetName } = prepareRows(mappingKey, rows, options);

    for (const chunk of chunkRows(normalizedRows)) {
      const result = await postAction(
        {
          action: "appendRows",
          sheet: sheetName,
          rows: chunk
        },
        sheetName
      );

      if (result && result.ok === false) {
        throw new Error(parseAppsScriptError(JSON.stringify(result), sheetName));
      }
    }

    return {
      mappingKey,
      tabName: sheetName,
      rowsWritten: normalizedRows.length
    };
  }

  async function replaceMappedRows(mappingKey, rows, options = {}) {
    const { mapping, normalizedRows, headers, formatting, sheetName } = prepareRows(mappingKey, rows, options);
    const chunks = chunkRows(normalizedRows);

    if (!chunks.length) {
      await postAction(
        {
          action: "replaceRows",
          sheet: sheetName,
          headers,
          formatting,
          rows: []
        },
        sheetName
      );

      return {
        mappingKey,
        tabName: sheetName,
        rowsWritten: 0
      };
    }

    await postAction(
      {
        action: "replaceRows",
        sheet: sheetName,
        headers,
        formatting,
        rows: chunks[0]
      },
      sheetName
    );

    for (let index = 1; index < chunks.length; index += 1) {
      await postAction(
        {
          action: "appendRows",
          sheet: sheetName,
          rows: chunks[index]
        },
        sheetName
      );
    }

    return {
      mappingKey,
      tabName: sheetName,
      rowsWritten: normalizedRows.length
    };
  }

  async function clearAndWriteMappedRows(mappingKey, rows, options = {}) {
    const { mapping, normalizedRows, headers, formatting, sheetName } = prepareRows(mappingKey, rows, options);
    const chunks = chunkRows(normalizedRows);

    await postAction(
      {
        action: "clearAndWrite",
        sheet: sheetName,
        headers,
        formatting,
        rows: chunks[0] || []
      },
      sheetName
    );

    for (let index = 1; index < chunks.length; index += 1) {
      await postAction(
        {
          action: "appendRows",
          sheet: sheetName,
          rows: chunks[index]
        },
        sheetName
      );
    }

    return {
      mappingKey,
      tabName: sheetName,
      rowsWritten: normalizedRows.length
    };
  }

  async function updateMappedRowByDate(mappingKey, date, row, options = {}) {
    const { mapping, normalizedRows, headers, formatting, sheetName } = prepareRows(mappingKey, [row], options);
    const normalizedDate = String(date || "").trim();
    const result = await postAction(
      {
        action: "updateByDate",
        sheet: sheetName,
        headers,
        formatting,
        dateColumn: options.dateColumn || "Дата",
        date: normalizedDate,
        row: normalizedRows[0],
        writeColumns: Array.isArray(options.writeColumns) ? options.writeColumns : undefined
      },
      sheetName
    );

    return {
      mappingKey,
      tabName: sheetName,
      rowsWritten: 1,
      matchedRow: result?.matchedRow ?? result?.rowIndex ?? null,
      dateMatchedAs: result?.dateMatchedAs ?? "",
      appended: Boolean(result?.appended)
    };
  }

  async function createMonthlySheet(mappingKey, options = {}) {
    const mapping = getSheetMapping(mappingKey);
    const targetSheet = options.targetSheet || mapping.tabName;
    const payload = {
      action: "createMonthlySheet",
      templateSheet: options.templateSheet,
      targetSheet,
      month: options.month
    };

    if (options.checkOnly) {
      payload.checkOnly = true;
    }

    const result = await postAction(payload, targetSheet);

    if (result && result.ok === false) {
      throw new Error(parseAppsScriptError(JSON.stringify(result), targetSheet));
    }

    return {
      mappingKey,
      tabName: targetSheet,
      targetSheet,
      month: options.month || "",
      templateSheet: options.templateSheet || "",
      created: Boolean(result?.created),
      exists: result?.exists === undefined ? !result?.created : Boolean(result.exists),
      checked: Boolean(options.checkOnly)
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
    createMonthlySheet,
    replaceMappedRows,
    updateMappedRowByDate
  };
}

module.exports = {
  chunkRows,
  createSheetsService,
  mergeFormatting,
  normalizeRows,
  parseAppsScriptError
};
