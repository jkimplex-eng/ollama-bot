const path = require("path");

require("dotenv").config();

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  model: process.env.OLLAMA_MODEL || "deepseek-r1:1.5b",
  ollamaChatUrl:
    process.env.OLLAMA_CHAT_URL ||
    process.env.OLLAMA_URL ||
    "http://127.0.0.1:11434/api/chat",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  googleSheetsWebappUrl: process.env.GOOGLE_SHEETS_WEBAPP_URL || "",
  ozonClientId: process.env.OZON_CLIENT_ID || "",
  ozonApiKey: process.env.OZON_API_KEY || "",
  ozonPerformanceClientId: process.env.OZON_PERFORMANCE_CLIENT_ID || "",
  ozonPerformanceClientSecret: process.env.OZON_PERFORMANCE_CLIENT_SECRET || "",
  paths: {
    memoryFile: path.join(rootDir, "memory.json"),
    profileFile: path.join(rootDir, "profile.json"),
    filesFile: path.join(rootDir, "files.json"),
    uploadDir: path.join(rootDir, "uploads"),
    knowledgeDir: path.join(rootDir, "knowledge"),
    exportDir: path.join(rootDir, "exports")
  }
};
