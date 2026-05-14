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

function createOllamaService({ chatUrl, models, state, timeoutMs = 120000 }) {
  function buildTagsUrl() {
    return chatUrl.replace(/\/api\/chat\/?$/i, "/api/tags");
  }

  function createAbortSignal() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timer)
    };
  }

  function normalizeOllamaError(error, model) {
    if (error && error.name === "AbortError") {
      return new Error(
        "Ollama не ответил вовремя для модели `" +
          model +
          "`. Увеличь OLLAMA_TIMEOUT_MS или проверь нагрузку на сервер."
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

  async function requestJson(url, body) {
    const { signal, dispose } = createAbortSignal();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Ollama вернул ошибку: " + response.status);
      }

      return response.json();
    } catch (error) {
      throw normalizeOllamaError(error, body.model);
    } finally {
      dispose();
    }
  }

  async function askOllama(messages, model) {
    const data = await requestJson(chatUrl, {
      model,
      stream: false,
      messages
    });

    return data.message?.content || "Нет ответа от модели.";
  }

  async function streamOllama(messages, model, onPart) {
    const { signal, dispose } = createAbortSignal();

    try {
      const response = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          messages
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
      throw normalizeOllamaError(error, model);
    } finally {
      dispose();
    }
  }

  async function askChat(prompt) {
    return askOllama(normalizePrompt(prompt), models.chat);
  }

  async function askCoder(prompt) {
    return askOllama(normalizePrompt(prompt), models.coder);
  }

  async function askAnalytics(prompt) {
    return askOllama(normalizePrompt(prompt), models.analytics);
  }

  async function streamChat(messages, onPart, model = models.chat) {
    return streamOllama(messages, model, onPart);
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

    const reply = await askOllama(messages, models.chat);

    memory.push({ role: "user", content: userMessage });
    memory.push({ role: "assistant", content: reply });
    state.saveMemory(memory);

    return reply;
  }

  async function getStatus() {
    const { signal, dispose } = createAbortSignal();

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
        error: normalizeOllamaError(error, models.chat).message,
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
      analytics: models.analytics
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
