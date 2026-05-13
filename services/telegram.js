const TelegramBot = require("node-telegram-bot-api");

function startTelegramBot({
  token,
  ollamaService,
  ozonService,
  sheetsService,
  logger = console
}) {
  if (!token) {
    logger.log("Telegram token not found. Telegram bot disabled.");
    return null;
  }

  const tgBot = new TelegramBot(token, { polling: true });

  tgBot.onText(/\/start/, async msg => {
    await tgBot.sendMessage(
      msg.chat.id,
      "Привет! Я твой локальный ИИ-бот. Напиши сообщение, и я отвечу через Ollama."
    );
  });

  tgBot.on("message", async msg => {
    const chatId = msg.chat.id;
    const text = msg.text || "";

    if (!text || text.startsWith("/start")) return;

    if (text.startsWith("/sheet ")) {
      try {
        const raw = text.replace("/sheet ", "").trim();
        const parts = raw.split("|").map(x => x.trim());

        const sheetName = parts[0] || "Лист1";
        const row = parts.slice(1);

        if (!row.length) {
          await tgBot.sendMessage(chatId, "Формат: /sheet Лист1 | товар | 10 | комментарий");
          return;
        }

        await sheetsService.addRow(sheetName, row);
        await tgBot.sendMessage(chatId, "Записал строку в Google Таблицу ✅");
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка записи в таблицу: " + err.message);
      }

      return;
    }

    if (text === "/ozon товары") {
      try {
        await tgBot.sendMessage(chatId, "Запрашиваю товары Ozon...");

        const products = await ozonService.getProducts();

        if (!products.length) {
          await tgBot.sendMessage(chatId, "Товары не найдены.");
          return;
        }

        const reply = products
          .map((p, i) => {
            return (
              i + 1 +
              ". product_id: " +
              p.product_id +
              "\noffer_id: " +
              p.offer_id
            );
          })
          .join("\n\n");

        await tgBot.sendMessage(chatId, reply.slice(0, 4000));
      } catch (err) {
        await tgBot.sendMessage(chatId, "Ошибка Ozon API: " + err.message);
      }

      return;
    }

    try {
      await tgBot.sendMessage(chatId, "Думаю...");
      const reply = await ollamaService.askSimple(text);
      await tgBot.sendMessage(chatId, reply.slice(0, 4000));
    } catch (err) {
      await tgBot.sendMessage(chatId, "Ошибка: " + err.message);
    }
  });

  logger.log("Telegram bot started");
  return tgBot;
}

module.exports = {
  startTelegramBot
};
