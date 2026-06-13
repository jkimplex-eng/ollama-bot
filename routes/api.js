const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { buildProfileText } = require("../services/ollama");

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createFileState(paths) {
  ensureDirectory(paths.uploadDir);
  ensureDirectory(paths.knowledgeDir);
  ensureDirectory(paths.exportDir);
  if (paths.reportsDir) ensureDirectory(paths.reportsDir);
  if (paths.dailyReportsDir) ensureDirectory(paths.dailyReportsDir);

  function loadJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  }

  function loadMemory() {
    return loadJson(paths.memoryFile, []);
  }

  function saveMemory(messages) {
    saveJson(paths.memoryFile, messages);
  }

  function loadProfile() {
    return loadJson(paths.profileFile, []);
  }

  function saveProfile(profile) {
    saveJson(paths.profileFile, profile);
  }

  function loadFiles() {
    return loadJson(paths.filesFile, []);
  }

  function saveFiles(files) {
    saveJson(paths.filesFile, files);
  }

  function isAllowedFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return [".txt", ".md", ".js", ".json"].includes(ext);
  }

  function loadKnowledge() {
    if (!fs.existsSync(paths.knowledgeDir)) return [];

    const files = fs.readdirSync(paths.knowledgeDir);
    const result = [];

    for (const file of files) {
      const fullPath = path.join(paths.knowledgeDir, file);

      if (!fs.statSync(fullPath).isFile()) continue;
      if (!isAllowedFile(file)) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf8");
        result.push({ name: file, content });
      } catch {}
    }

    return result;
  }

  function exportHistory(model) {
    const memory = loadMemory();
    const profile = loadProfile();
    const files = loadFiles();
    const knowledge = loadKnowledge();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(paths.exportDir, "history-" + timestamp + ".json");
    const mdPath = path.join(paths.exportDir, "history-" + timestamp + ".md");

    const jsonData = {
      exportedAt: new Date().toISOString(),
      model,
      profile,
      uploadedFiles: files.map(f => ({ name: f.name, size: f.content.length })),
      knowledgeFiles: knowledge.map(f => ({ name: f.name, size: f.content.length })),
      memory
    };

    saveJson(jsonPath, jsonData);

    let md = "# Экспорт истории локального ИИ\n\n";
    md += "Дата экспорта: " + new Date().toLocaleString("ru-RU") + "\n\n";
    md += "Модель: `" + model + "`\n\n";

    md += "## Профиль\n\n";
    md += profile.length
      ? profile.map((x, i) => i + 1 + ". " + x).join("\n")
      : "Профиль пуст.";

    md += "\n\n## История\n\n";

    for (const msg of memory) {
      const label = msg.role === "user" ? "Пользователь" : "Бот";
      md += "### " + label + "\n\n" + msg.content + "\n\n";
    }

    fs.writeFileSync(mdPath, md, "utf8");

    return { jsonPath, mdPath };
  }

  return {
    paths,
    loadMemory,
    saveMemory,
    loadProfile,
    saveProfile,
    loadFiles,
    saveFiles,
    loadKnowledge,
    isAllowedFile,
    exportHistory
  };
}

function isRememberCommand(text) {
  return text.toLowerCase().startsWith("запомни:");
}

function extractMemoryFact(text) {
  return text.replace(/^запомни:/i, "").trim();
}

function isSearchCommand(text) {
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith("/поиск ") ||
    lower.startsWith("/search ") ||
    lower.startsWith("найди в интернете ")
  );
}

function extractSearchQuery(text) {
  return text
    .replace(/^\/поиск\s+/i, "")
    .replace(/^\/search\s+/i, "")
    .replace(/^найди в интернете\s+/i, "")
    .trim();
}

function isExportCommand(text) {
  const lower = text.toLowerCase().trim();
  return lower === "/экспорт" || lower === "/export" || lower === "экспорт истории";
}

function isCoderCommand(text) {
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith("/код") ||
    lower.startsWith("/code") ||
    lower.startsWith("/исправь") ||
    lower.startsWith("/объясни") ||
    lower.startsWith("/создай") ||
    lower.startsWith("/coder")
  );
}

function getCoderInstructions() {
  return (
    "\n\nВключён режим Кодер. Работай как аккуратный помощник по программированию. " +
    "Если пользователь просит исправить код, сначала кратко объясни проблему, потом дай готовый исправленный код. " +
    "Если пользователь просит создать файл или функцию, дай полный рабочий пример. " +
    "Пиши код в Markdown-блоках с указанием языка, например ```js. " +
    "Не придумывай лишние зависимости. Для Windows и PowerShell объясняй максимально пошагово."
  );
}

function looksImportantFact(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("меня зовут") ||
    lower.includes("я работаю") ||
    lower.includes("мой проект") ||
    lower.includes("мне нужно") ||
    lower.includes("я хочу") ||
    lower.includes("объясняй") ||
    lower.includes("предпочитаю")
  );
}

function autoSaveFactIfUseful(text, state) {
  const cleaned = text.trim();

  if (!cleaned || cleaned.length < 8 || cleaned.length > 300) return null;
  if (!looksImportantFact(cleaned)) return null;

  const profile = state.loadProfile();

  if (!profile.some(item => item.toLowerCase() === cleaned.toLowerCase())) {
    profile.push(cleaned);
    state.saveProfile(profile);
    return cleaned;
  }

  return null;
}

async function searchDuckDuckGo(query) {
  const wikiUrl =
    "https://ru.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(query);

  try {
    const response = await fetch(wikiUrl, {
      headers: {
        "User-Agent": "LocalOllamaBot/1.0"
      }
    });

    if (response.ok) {
      const data = await response.json();

      if (data.extract) {
        return [
          {
            title: data.title || query,
            url: data.content_urls?.desktop?.page || wikiUrl,
            snippet: data.extract
          }
        ];
      }
    }
  } catch {}

  return [
    {
      title: "Поиск не сработал",
      url: wikiUrl,
      snippet:
        "Пока работает простой поиск через Wikipedia. Позже можно подключить Google/Yandex API."
    }
  ];
}

function renderHomePage() {
  return String.raw`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Мой локальный ИИ</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0f1115; color: #eee; }
    .wrap { max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { margin: 10px 0 4px; }
    .sub { color: #aaa; margin-bottom: 20px; }
    #chat { height: 60vh; overflow-y: auto; background: #171a21; border: 1px solid #2a2f3a; border-radius: 14px; padding: 18px; }
    .msg { margin: 12px 0; padding: 12px 14px; border-radius: 12px; line-height: 1.45; }
    .user { background: #21395f; margin-left: 80px; }
    .bot { background: #26392b; margin-right: 80px; }
    .role { font-weight: bold; margin-bottom: 6px; opacity: 0.9; }
    textarea { width: 100%; height: 90px; margin-top: 14px; background: #171a21; color: #eee; border: 1px solid #2a2f3a; border-radius: 12px; padding: 12px; font-size: 16px; box-sizing: border-box; }
    .buttons { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
    button { padding: 10px 16px; border-radius: 10px; border: 0; cursor: pointer; background: #e6e6e6; }
    button.danger { background: #7d2a2a; color: white; }
    input[type="file"] { background: #171a21; border: 1px solid #2a2f3a; border-radius: 10px; padding: 8px; color: #eee; }
    pre { background: #0b0b0b; padding: 14px; border-radius: 10px; overflow-x: auto; white-space: pre-wrap; }
    code { background: #0b0b0b; padding: 2px 6px; border-radius: 6px; }
    pre code { padding: 0; background: transparent; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Мой локальный ИИ</h1>
    <div class="sub">Ollama + память + профиль + файлы + база знаний + поиск + экспорт + режим Кодер</div>

    <div id="chat"></div>

    <textarea id="input" placeholder="Напиши сообщение... Команды: /код, /исправь, /объясни, /создай, /поиск, /экспорт, запомни:"></textarea>

    <div class="buttons">
      <button onclick="sendMessage()">Отправить</button>
      <button onclick="loadHistory()">Обновить историю</button>
      <button onclick="showProfile()">Показать профиль</button>
      <button onclick="showFiles()">Показать файлы</button>
      <button onclick="showKnowledge()">Показать базу знаний</button>
      <button onclick="exportHistory()">Экспорт истории</button>
      <button onclick="insertCoderPrompt()">Режим Кодер</button>
      <input id="fileInput" type="file" accept=".txt,.md,.js,.json" />
      <button onclick="uploadFile()">Загрузить файл</button>
      <button class="danger" onclick="clearMemory()">Очистить историю</button>
      <button class="danger" onclick="clearProfile()">Очистить профиль</button>
      <button class="danger" onclick="clearFiles()">Очистить файлы</button>
    </div>
  </div>

  <script>
    const chat = document.getElementById("chat");
    const input = document.getElementById("input");
    const fileInput = document.getElementById("fileInput");

    function escapeHtml(text) {
      return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    function renderMarkdown(text) {
      let html = escapeHtml(text);
      const fence = String.fromCharCode(96, 96, 96);
      const tick = String.fromCharCode(96);

      html = html.replace(new RegExp(fence + "([\\s\\S]*?)" + fence, "g"), function(_, code) {
        return "<pre><code>" + code.trim() + "</code></pre>";
      });

      html = html.replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), "<code>$1</code>");
      html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
      html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
      html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");
      html = html.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
      html = html.replace(/\n/g, "<br>");

      return html;
    }

    function addMessage(role, text) {
      const div = document.createElement("div");
      div.className = "msg " + (role === "user" ? "user" : "bot");

      const label = document.createElement("div");
      label.className = "role";
      label.textContent = role === "user" ? "Ты" : "Бот";

      const body = document.createElement("div");
      body.innerHTML = renderMarkdown(text);

      div.appendChild(label);
      div.appendChild(body);
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;

      return body;
    }

    async function loadHistory() {
      chat.innerHTML = "";
      const res = await fetch("/history");
      const data = await res.json();

      for (const msg of data.messages) {
        if (msg.role === "user" || msg.role === "assistant") {
          addMessage(msg.role === "assistant" ? "bot" : "user", msg.content);
        }
      }
    }

    async function showProfile() {
      const res = await fetch("/profile");
      const data = await res.json();

      if (!data.profile.length) {
        addMessage("bot", "Профиль пока пуст. Напиши: запомни: ...");
        return;
      }

      addMessage("bot", "## Мой профиль о тебе:\n\n" + data.profile.map((x, i) => (i + 1) + ". " + x).join("\n"));
    }

    async function showFiles() {
      const res = await fetch("/files");
      const data = await res.json();

      if (!data.files.length) {
        addMessage("bot", "Файлы пока не загружены.");
        return;
      }

      addMessage("bot", "## Загруженные файлы:\n\n" + data.files.map((f, i) => (i + 1) + ". " + f.name + " (" + f.size + " символов)").join("\n"));
    }

    async function showKnowledge() {
      const res = await fetch("/knowledge");
      const data = await res.json();

      if (!data.knowledge.length) {
        addMessage("bot", "База знаний пока пустая. Положи .txt/.md/.js/.json файлы в папку knowledge.");
        return;
      }

      addMessage("bot", "## База знаний:\n\n" + data.knowledge.map((f, i) => (i + 1) + ". " + f.name + " (" + f.size + " символов)").join("\n"));
    }

    async function uploadFile() {
      if (!fileInput.files.length) {
        addMessage("bot", "Сначала выбери файл.");
        return;
      }

      const formData = new FormData();
      formData.append("file", fileInput.files[0]);

      const res = await fetch("/upload", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      addMessage("bot", data.message);
      fileInput.value = "";
    }

    async function exportHistory() {
      const res = await fetch("/export", { method: "POST" });
      const data = await res.json();
      addMessage("bot", data.message);
    }

    function insertCoderPrompt() {
      input.value = "/код ";
      input.focus();
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;

      addMessage("user", text);
      input.value = "";

      const botBody = addMessage("bot", "");

      const res = await fetch("/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fullText += decoder.decode(value);
        botBody.innerHTML = renderMarkdown(fullText);
        chat.scrollTop = chat.scrollHeight;
      }
    }

    async function clearMemory() {
      if (!confirm("Точно очистить историю?")) return;
      await fetch("/clear-memory", { method: "POST" });
      await loadHistory();
    }

    async function clearProfile() {
      if (!confirm("Точно очистить профиль?")) return;
      await fetch("/clear-profile", { method: "POST" });
      addMessage("bot", "Профиль очищен.");
    }

    async function clearFiles() {
      if (!confirm("Точно очистить загруженные файлы?")) return;
      await fetch("/clear-files", { method: "POST" });
      addMessage("bot", "Файлы очищены.");
    }

    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && e.ctrlKey) sendMessage();
    });

    loadHistory();
  </script>
</body>
</html>
  `;
}

function createApiRouter({
  state,
  ollamaService,
  defaultModel,
  cronSecret = "",
  dailySummaryService,
  ozonCaptureQueueService,
  ozonCaptureWorkerSecret = "",
  telegramService
}) {
  const router = Router();
  const upload = multer({
    dest: state.paths.uploadDir,
    limits: { fileSize: 1024 * 1024 * 2 }
  });

  function isAuthorizedWorker(req) {
    return Boolean(
      ozonCaptureQueueService &&
      ozonCaptureWorkerSecret &&
      req.headers["x-worker-secret"] === ozonCaptureWorkerSecret
    );
  }

  async function sendCaptureResultToTelegram(job) {
    if (!telegramService || !job.chatId || !job.result || typeof telegramService.sendText !== "function") {
      return;
    }

    const meta = job.result.meta || {};
    const pageState = meta.page_state || {};
    const lines = [
      "Ozon capture complete",
      "Target section: " + (meta.target_section || job.targetSection || "-"),
      "URL: " + (meta.current_url || "-"),
      "Title: " + (meta.title || "-"),
      "Connection mode: " + (meta.connection_mode || "-"),
      "Challenge detected: " + (pageState.challenge_detected ? "yes" : "no"),
      "Auth required: " + (pageState.auth_required_detected ? "yes" : "no"),
      "HTML: " + ((meta.artifacts && meta.artifacts.html) || "-"),
      "Screenshot: " + ((meta.artifacts && meta.artifacts.screenshot) || "-")
    ];

    await telegramService.sendText(job.chatId, lines.join("\n"));

    if (job.debug) {
      await telegramService.sendText(job.chatId, JSON.stringify(meta, null, 2));
    }

    if (job.result.screenshotPath && typeof telegramService.sendDocument === "function") {
      try {
        await telegramService.sendDocument(job.chatId, job.result.screenshotPath, {
          caption: "Ozon Seller screenshot"
        });
      } catch (err) {
        await telegramService.sendText(job.chatId, "Не удалось отправить screenshot: " + err.message);
      }
    }
  }

  router.get("/", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderHomePage());
  });

  router.get("/history", (req, res) => {
    res.json({ messages: state.loadMemory() });
  });

  router.get("/profile", (req, res) => {
    res.json({ profile: state.loadProfile() });
  });

  router.get("/files", (req, res) => {
    res.json({
      files: state.loadFiles().map(f => ({ name: f.name, size: f.content.length }))
    });
  });

  router.get("/knowledge", (req, res) => {
    res.json({
      knowledge: state.loadKnowledge().map(f => ({ name: f.name, size: f.content.length }))
    });
  });

  router.post("/clear-memory", (req, res) => {
    state.saveMemory([]);
    res.json({ ok: true });
  });

  router.post("/clear-profile", (req, res) => {
    state.saveProfile([]);
    res.json({ ok: true });
  });

  router.post("/clear-files", (req, res) => {
    state.saveFiles([]);
    res.json({ ok: true });
  });

  router.post("/export", (req, res) => {
    try {
      const result = state.exportHistory(defaultModel);
 

      res.json({
        ok: true,
        message:
          "История экспортирована.\n\nJSON: " +
          result.jsonPath +
          "\nMarkdown: " +
          result.mdPath
      });
    } catch (err) {
      res.json({ ok: false, message: "Ошибка экспорта: " + err.message });
    }
  });

  router.post("/upload", upload.single("file"), (req, res) => {
    try {
      if (!req.file) {
        res.json({ ok: false, message: "Файл не получен." });
        return;
      }

      if (!state.isAllowedFile(req.file.originalname)) {
        fs.unlinkSync(req.file.path);
        res.json({
          ok: false,
          message: "Можно загружать только .txt, .md, .js, .json"
        });
        return;
      }

      const content = fs.readFileSync(req.file.path, "utf8");
      fs.unlinkSync(req.file.path);

      const files = state.loadFiles();
      files.push({
        name: req.file.originalname,
        content
      });
      state.saveFiles(files);

      const memory = state.loadMemory();
      memory.push({ role: "user", content: "Загрузил файл: " + req.file.originalname });
      memory.push({ role: "assistant", content: "Файл загружен: " + req.file.originalname });
      state.saveMemory(memory);

      res.json({
        ok: true,
        message:
          "Файл загружен: " +
          req.file.originalname +
          "\nТеперь можешь спросить: объясни загруженный файл."
      });
    } catch (err) {
      res.json({ ok: false, message: "Ошибка загрузки файла: " + err.message });
    }
  });

  router.post("/cron/daily-summary", async (req, res) => {
    const incomingSecret = req.headers["x-cron-secret"];

    if (!cronSecret || incomingSecret !== cronSecret) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    if (!dailySummaryService) {
      res.status(503).json({ ok: false, error: "Daily summary service unavailable" });
      return;
    }

    try {
      const result = await dailySummaryService.generateDailySummary();
      res.json({
        ok: true,
        reportPath: result.reportPath,
        sentToTelegram: result.sentToTelegram
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  });

  router.post("/api/ozon-capture/claim", (req, res) => {
    if (!isAuthorizedWorker(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const job = ozonCaptureQueueService.claimNextJob();
    res.json({ ok: true, job });
  });

  router.post("/api/ozon-capture/:jobId/complete", async (req, res) => {
    if (!isAuthorizedWorker(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    try {
      const job = ozonCaptureQueueService.completeJob(req.params.jobId, req.body || {});
      await sendCaptureResultToTelegram(job);
      res.json({ ok: true, jobId: job.id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/api/ozon-capture/:jobId/fail", (req, res) => {
    if (!isAuthorizedWorker(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    try {
      const job = ozonCaptureQueueService.failJob(req.params.jobId, req.body?.error || "");
      res.json({ ok: true, jobId: job.id });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post("/chat-stream", async (req, res) => {
    try {
      const userMessage = req.body.message || "";
      const memory = state.loadMemory();
      const profile = state.loadProfile();
      const files = state.loadFiles();
      const knowledge = state.loadKnowledge();

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");

      if (isExportCommand(userMessage)) {
        const result = state.exportHistory(defaultModel);
        const message =
          "История экспортирована.\n\nJSON: " +
          result.jsonPath +
          "\nMarkdown: " +
          result.mdPath;

        memory.push({ role: "user", content: userMessage });
        memory.push({ role: "assistant", content: message });
        state.saveMemory(memory);

        res.write(message);
        res.end();
        return;
      }

      if (isRememberCommand(userMessage)) {
        const fact = extractMemoryFact(userMessage);

        if (!fact) {
          res.write("Напиши после `запомни:` что именно сохранить.");
          res.end();
          return;
        }

        const profileNow = state.loadProfile();

        if (!profileNow.some(item => item.toLowerCase() === fact.toLowerCase())) {
          profileNow.push(fact);
          state.saveProfile(profileNow);
        }

        memory.push({ role: "user", content: userMessage });
        memory.push({ role: "assistant", content: "Запомнил: " + fact });
        state.saveMemory(memory);

        res.write("Запомнил: " + fact);
        res.end();
        return;
      }

      if (isSearchCommand(userMessage)) {
        const query = extractSearchQuery(userMessage);

        if (!query) {
          res.write("Напиши запрос после `/поиск`, например: `/поиск Ollama`.");
          res.end();
          return;
        }

        res.write("Ищу: " + query + "\n\n");
        const results = await searchDuckDuckGo(query);

        let searchText = "Результаты поиска по запросу: " + query + "\n\n";

        for (const [index, item] of results.entries()) {
          searchText +=
            index + 1 + ". " + item.title + "\n" +
            item.url + "\n" +
            item.snippet + "\n\n";
        }

        res.write(searchText);

        memory.push({ role: "user", content: userMessage });
        memory.push({ role: "assistant", content: searchText });
        state.saveMemory(memory);

        res.end();
        return;
      }

      const autoSaved = autoSaveFactIfUseful(userMessage, state);
      const coderMode = isCoderCommand(userMessage);

      const filesText = files.length
        ? "Вот загруженные пользователем файлы:\n\n" +
          files
            .map((file, index) => {
              const preview = file.content.slice(0, 6000);
              return "Файл " + (index + 1) + ": " + file.name + "\n```\n" + preview + "\n```";
            })
            .join("\n\n")
        : "Загруженных файлов пока нет.";

      const knowledgeText = knowledge.length
        ? "Вот локальная база знаний:\n\n" +
          knowledge
            .map((file, index) => {
              const preview = file.content.slice(0, 6000);
              return "Документ " + (index + 1) + ": " + file.name + "\n```\n" + preview + "\n```";
            })
            .join("\n\n")
        : "Локальная база знаний пока пустая.";

      const autoSavedText = autoSaved
        ? "\n\nВажно: я автоматически сохранил в профиль новый факт: " + autoSaved
        : "";

      const coderText = coderMode ? getCoderInstructions() : "";

      const messages = [
        {
          role: "system",
          content:
            "Ты дружелюбный русскоязычный локальный помощник. Отвечай просто, понятно и пошагово. " +
            "Учитывай профиль пользователя. Если пользователь новичок, объясняй очень простыми словами.\n\n" +
            buildProfileText(profile) +
            "\n\n" +
            filesText +
            "\n\n" +
            knowledgeText +
            autoSavedText +
            coderText
        },
        ...memory.slice(-20),
        {
          role: "user",
          content: userMessage
        }
      ];

      const selectedModel = coderMode
        ? ollamaService.getModels().coder
        : ollamaService.getModels().chat;

      let reply = await ollamaService.streamChat(messages, part => {
        res.write(part);
      }, selectedModel);

      if (autoSaved) {
        const savedNote = "\n\n_Я сохранил новый факт в профиль: " + autoSaved + "_";
        reply += savedNote;
        res.write(savedNote);
      }

      memory.push({ role: "user", content: userMessage });
      memory.push({ role: "assistant", content: reply });
      state.saveMemory(memory);

      res.end();
    } catch (err) {
      res.write("Ошибка: " + err.message);
      res.end();
    }
  });

  return router;
}

module.exports = {
  createApiRouter,
  createFileState
};
