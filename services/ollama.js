function buildProfileText(profile) {
  return profile.length
    ? "Вот долговременная память о пользователе:\n- " + profile.join("\n- ")
    : "Долговременная память о пользователе пока пустая.";
}

function createOllamaService({ model, chatUrl, state }) {
  async function completeChat(messages) {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Ollama вернул ошибку: " + response.status);
    }

    const data = await response.json();
    return data.message?.content || "Нет ответа от модели.";
  }

  async function streamChat(messages, onPart) {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        messages
      })
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

    const reply = await completeChat(messages);

    memory.push({ role: "user", content: userMessage });
    memory.push({ role: "assistant", content: reply });
    state.saveMemory(memory);

    return reply;
  }

  return {
    askSimple,
    completeChat,
    streamChat
  };
}

module.exports = {
  buildProfileText,
  createOllamaService
};
