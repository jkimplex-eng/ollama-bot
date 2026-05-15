const fs = require("fs");
const path = require("path");
const env = require("../config/env");

const requiredEnv = [
  "TELEGRAM_BOT_TOKEN",
  "OZON_CLIENT_ID",
  "OZON_API_KEY",
  "GOOGLE_SHEETS_WEBAPP_URL"
];

const optionalEnv = [
  "OZON_PERFORMANCE_CLIENT_ID",
  "OZON_PERFORMANCE_CLIENT_SECRET",
  "CRON_SECRET",
  "DAILY_SUMMARY_CHAT_ID",
  "OLLAMA_CHAT_MODEL",
  "OLLAMA_CODER_MODEL",
  "OLLAMA_ANALYTICS_MODEL"
];

const requiredFiles = [
  "server.js",
  "package.json",
  "README.md",
  "config/env.js",
  "config/sheetsMap.js",
  "routes/api.js",
  "services/telegram.js",
  "services/ollama.js",
  "services/ozon.js",
  "services/performance.js",
  "services/sheets.js",
  "scripts/checkSheetsAndPerformance.js",
  "docs/AGENT.md",
  "docs/ROADMAP.md",
  "docs/RUNBOOK.md"
];

function line(ok, label, detail = "") {
  return (ok ? "[OK] " : "[WARN] ") + label + (detail ? " - " + detail : "");
}

function exists(relativePath) {
  return fs.existsSync(path.join(env.rootDir, relativePath));
}

function main() {
  const out = [];
  let warnings = 0;

  out.push("Project health check");
  out.push("");
  out.push("Environment:");

  for (const name of requiredEnv) {
    const ok = Boolean(process.env[name]);
    if (!ok) warnings += 1;
    out.push(line(ok, name, ok ? "present" : "missing"));
  }

  for (const name of optionalEnv) {
    const ok = Boolean(process.env[name]);
    out.push(line(ok, name, ok ? "present" : "not set"));
  }

  out.push("");
  out.push("Config:");

  const portOk = Number.isFinite(env.port) && env.port > 0;
  if (!portOk) warnings += 1;
  out.push(line(portOk, "PORT", String(env.port)));

  const ollamaUrlOk = /^https?:\/\//.test(env.ollamaChatUrl);
  if (!ollamaUrlOk) warnings += 1;
  out.push(line(ollamaUrlOk, "OLLAMA_CHAT_URL", env.ollamaChatUrl));

  out.push("");
  out.push("Files:");

  for (const file of requiredFiles) {
    const ok = exists(file);
    if (!ok) warnings += 1;
    out.push(line(ok, file, ok ? "exists" : "missing"));
  }

  out.push("");
  out.push("Paths:");

  const directories = [
    env.paths.logsDir,
    env.paths.reportsDir,
    env.paths.dailyReportsDir,
    env.paths.knowledgeDir,
    env.paths.uploadDir
  ];

  for (const dir of directories) {
    const relative = path.relative(env.rootDir, dir);
    const ok = fs.existsSync(dir);
    out.push(line(ok, relative, ok ? "exists" : "will be created at runtime if needed"));
  }

  out.push("");
  out.push(warnings === 0 ? "Overall: healthy" : "Overall: warnings=" + warnings);

  console.log(out.join("\n"));
}

main();
