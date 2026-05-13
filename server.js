const express = require("express");
const env = require("./config/env");
const { createApiRouter, createFileState } = require("./routes/api");
const { createCalendarService } = require("./services/calendar");
const { createOllamaService } = require("./services/ollama");
const { createOzonService } = require("./services/ozon");
const { createSheetsService } = require("./services/sheets");
const { startTelegramBot } = require("./services/telegram");

const app = express();
const state = createFileState(env.paths);

const ollamaService = createOllamaService({
  model: env.model,
  chatUrl: env.ollamaChatUrl,
  state
});

const ozonService = createOzonService({
  clientId: env.ozonClientId,
  apiKey: env.ozonApiKey,
  performanceClientId: env.ozonPerformanceClientId,
  performanceClientSecret: env.ozonPerformanceClientSecret
});

const sheetsService = createSheetsService({
  webappUrl: env.googleSheetsWebappUrl
});

createCalendarService();

app.use(express.json({ limit: "5mb" }));
app.use(
  createApiRouter({
    state,
    ollamaService,
    model: env.model
  })
);

startTelegramBot({
  token: env.telegramBotToken,
  ollamaService,
  ozonService,
  sheetsService
});

app.listen(env.port, () => {
  console.log("Bot started: http://127.0.0.1:" + env.port);
});
