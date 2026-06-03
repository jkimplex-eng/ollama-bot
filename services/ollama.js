function buildProfileText(profile) {
  return profile.length
    ? "Вот долговременная память о пользователе:\n- " + profile.join("\n- ")
    : "Долговременная память о пользователе пока пустая.";
}

function normalizePrompt(prompt) {
  if (Array.isArray(prompt)) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: String(prompt || "")
    }
  ];
}

function limitMessages(messages, maxChars) {
  if (!maxChars || maxChars < 100) {
    return messages;
  }

  const normalized = messages.map(message => ({
    role: message.role,
    content: String(message.content || "")
  }));

  let totalChars = normalized.reduce((sum, item) => sum + item.content.length, 0);

  if (totalChars <= maxChars) {
    return normalized;
  }

  const result = [...normalized];

  for (let index = 0; index < result.length && totalChars > maxChars; index += 1) {
    const item = result[index];
    const remaining = maxChars - (totalChars - item.content.length);
    const allowedChars = Math.max(index === result.length - 1 ? 200 : 0, remaining);

    if (item.content.length > allowedChars) {
      const keepTail = index === result.length - 1;
      item.content = keepTail
        ? item.content.slice(-allowedChars)
        : item.content.slice(0, allowedChars);
      totalChars = result.reduce((sum, current) => sum + current.content.length, 0);
    }
  }

  return result;
}

function getPromptSize(messages) {
  return messages.reduce((sum, item) => sum + String(item.content || "").length, 0);
}

function createOllamaService({
  chatUrl,
  models,
  state,
  timeoutMs = 120000,
  maxPromptChars = 12000,
  decisionTimeoutMs = 600000,
  logger = console
}) {
  function buildTagsUrl() {
    return chatUrl.replace(/\/api\/chat\/?$/i, "/api/tags");
  }

  function createAbortSignal(activeTimeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), activeTimeoutMs);

    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timer)
    };
  }

  function logOllamaError(metadata, error) {
    logger.error("[ollama] request failed", {
      model: metadata.model,
      promptSize: metadata.promptSize,
      endpoint: metadata.endpoint,
      timeoutMs: metadata.timeoutMs,
      error: error.message
    });
  }

  function normalizeOllamaError(error, metadata) {
    logOllamaError(metadata, error);

    if (error && error.name === "AbortError") {
      return new Error(
        "Ollama не ответил вовремя для модели `" +
          metadata.model +
          "`. Проверь нагрузку на CPU VPS или увеличь timeout."
      );
    }

    if (error instanceof TypeError) {
      return new Error(
        "Не удалось подключиться к Ollama по адресу `" +
          chatUrl +
          "`. Проверь, что Ollama запущен и API доступен."
      );
    }

    return error;
  }

  async function requestJson(url, body, options = {}) {
    const activeTimeoutMs = options.timeoutMs || timeoutMs;
    const messages = limitMessages(body.messages || [], options.maxPromptChars || maxPromptChars);
    const promptSize = getPromptSize(messages);
    const metadata = {
      model: body.model,
      promptSize,
      endpoint: options.endpoint || "chat",
      timeoutMs: activeTimeoutMs
    };
    const { signal, dispose } = createAbortSignal(activeTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          messages
        }),
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Ollama вернул ошибку: " + response.status);
      }

      return response.json();
    } catch (error) {
      throw normalizeOllamaError(error, metadata);
    } finally {
      dispose();
    }
  }

  async function askOllama(messages, model, options = {}) {
    const data = await requestJson(
      chatUrl,
      {
        model,
        stream: false,
        messages
      },
      options
    );

    return data.message?.content || "Нет ответа от модели.";
  }

  async function streamOllama(messages, model, onPart, options = {}) {
    const activeTimeoutMs = options.timeoutMs || timeoutMs;
    const limitedMessages = limitMessages(messages, options.maxPromptChars || maxPromptChars);
    const promptSize = getPromptSize(limitedMessages);
    const metadata = {
      model,
      promptSize,
      endpoint: options.endpoint || "stream",
      timeoutMs: activeTimeoutMs
    };
    const { signal, dispose } = createAbortSignal(activeTimeoutMs);

    try {
      const response = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          messages: limitedMessages
        }),
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Ollama вернул ошибку: " + response.status);
      }

      if (!response.body) {
        throw new Error("Ollama не вернул поток ответа.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            const part = json.message?.content || "";

            if (part) {
              reply += part;
              onPart(part);
            }
          } catch {}
        }
      }

      return reply;
    } catch (error) {
      throw normalizeOllamaError(error, metadata);
    } finally {
      dispose();
    }
  }

  function getChatModel(preferFast = false) {
    if (preferFast && models.fast) {
      return models.fast;
    }

    return models.chat;
  }

  async function askChat(prompt, options = {}) {
    return askOllama(normalizePrompt(prompt), getChatModel(Boolean(options.preferFast)), {
      endpoint: options.endpoint || "chat",
      timeoutMs: options.timeoutMs,
      maxPromptChars: options.maxPromptChars
    });
  }

  async function askCoder(prompt, options = {}) {
    return askOllama(normalizePrompt(prompt), models.coder, {
      endpoint: options.endpoint || "coder",
      timeoutMs: options.timeoutMs,
      maxPromptChars: options.maxPromptChars
    });
  }

  async function askAnalytics(prompt, options = {}) {
    return askOllama(normalizePrompt(prompt), models.analytics, {
      endpoint: options.endpoint || "analytics",
      timeoutMs: options.timeoutMs || decisionTimeoutMs,
      maxPromptChars: options.maxPromptChars || maxPromptChars
    });
  }

  async function streamChat(messages, onPart, model = models.chat) {
    return streamOllama(messages, model, onPart, {
      endpoint: "stream-chat"
    });
  }

  async function askSimple(userMessage) {
    const memory = state.loadMemory();
    const profile = state.loadProfile();

    const messages = [
      {
        role: "system",
        content:
          "Ты дружелюбный русскоязычный локальный помощник. Отвечай просто и пошагово.\n\n" +
          buildProfileText(profile)
      },
      ...memory.slice(-10),
      {
        role: "user",
        content: userMessage
      }
    ];

    const reply = await askOllama(messages, getChatModel(true), {
      endpoint: "simple-chat"
    });

    memory.push({ role: "user", content: userMessage });
    memory.push({ role: "assistant", content: reply });
    state.saveMemory(memory);

    return reply;
  }

  async function getStatus() {
    const { signal, dispose } = createAbortSignal(timeoutMs);

    try {
      const response = await fetch(buildTagsUrl(), {
        method: "GET",
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Ollama вернул ошибку: " + response.status);
      }

      const data = await response.json();
      const availableModels = (data.models || []).map(item => item.name);

      return {
        ok: true,
        url: chatUrl,
        availableModels
      };
    } catch (error) {
      return {
        ok: false,
        url: chatUrl,
        error: normalizeOllamaError(error, {
          model: models.chat,
          promptSize: 0,
          endpoint: "tags",
          timeoutMs
        }).message,
        availableModels: []
      };
    } finally {
      dispose();
    }
  }

  function getModels() {
    return {
      chat: models.chat,
      coder: models.coder,
      analytics: models.analytics,
      fast: models.fast || ""
    };
  }

  return {
    askAnalytics,
    askChat,
    askCoder,
    askOllama,
    askSimple,
    getModels,
    getStatus,
    streamChat
  };
}

module.exports = {
  buildProfileText,
  createOllamaService
};
