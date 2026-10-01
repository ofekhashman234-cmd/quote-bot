// 📲 טלגרם: שליחת התראות (עם התמונה המקורית), כפתורי משוב, ופקודות.
import { handleCommand, HELP } from "./commands.js";

const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4096;

export class Telegram {
  constructor({ token, chatId, fetchImpl = fetch }) {
    this.base = `https://api.telegram.org/bot${token}`;
    this.chatId = chatId;
    this.fetch = fetchImpl;
    this.offset = 0;
  }

  async call(method, body = {}) {
    const isForm = body instanceof FormData;
    const res = await this.fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: isForm ? undefined : { "content-type": "application/json" },
      body: isForm ? body : JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  }

  #extras({ replyTo, buttons, forceReply } = {}) {
    const extras = {};
    if (replyTo) extras.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
    if (buttons) extras.reply_markup = { inline_keyboard: buttons };
    if (forceReply) extras.reply_markup = { force_reply: true };
    return extras;
  }

  async sendText(text, opts = {}, chatId = this.chatId) {
    const msg = await this.call("sendMessage", { chat_id: chatId, text: clip(text, TEXT_LIMIT), ...this.#extras(opts) });
    return msg.message_id;
  }

  async #sendFile(method, field, file, caption, opts = {}) {
    const form = new FormData();
    form.append("chat_id", String(this.chatId));
    form.append(field, new Blob([file.buffer], { type: file.mimetype }), file.filename);
    if (caption) form.append("caption", clip(caption, CAPTION_LIMIT));
    for (const [key, value] of Object.entries(this.#extras(opts))) form.append(key, JSON.stringify(value));
    const msg = await this.call(method, form);
    return msg.message_id;
  }

  sendPhoto(file, caption, opts) {
    return this.#sendFile("sendPhoto", "photo", file, caption, opts);
  }

  sendVideo(file, caption, opts) {
    return this.#sendFile("sendVideo", "video", file, caption, opts);
  }

  answerCallback(id, text) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text });
  }

  /** long polling: מקבל הודעות ולחיצות על כפתורים ומעביר ל-onUpdate. */
  async poll(onUpdate) {
    for (;;) {
      try {
        const updates = await this.call("getUpdates", {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ["message", "callback_query"],
        });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await onUpdate(u).catch((err) => console.error("שגיאה בטיפול בהודעת טלגרם:", err));
        }
      } catch (err) {
        console.error("טלגרם לא זמין, מנסה שוב:", err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

function clip(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const timeOf = (ts) =>
  new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });

/** הטקסט של ההתראה. */
export function formatAlert({ alert, decision, result, post, wants, groupName, dryRun, degraded }) {
  const head = decision.level === "match" ? "🎯 " : "🤔 אולי: ";
  const title = [result.item_summary || "פריט", result.price, result.location].filter(Boolean).join(" · ");
  const lines = [
    `${dryRun ? "[ניסיון] " : ""}${post.late ? "⏱️ באיחור · " : ""}${head}${title}`,
    alert.text ? `"${clip(alert.text, 500)}"` : "(תמונה בלבד, בלי טקסט)",
    ...decision.items.map((i) => {
      const want = wants.find((w) => w.id === i.wantId);
      return `${i.level === "maybe" ? "אולי מתאים" : "מתאים"} ל: #${i.wantId} ${want?.text ?? ""} (${i.reason})`;
    }),
    `👥 ${groupName} · 👤 ${alert.senderName || "לא ידוע"} · 🕒 ${timeOf(post.ts)}`,
  ];
  if (degraded) lines.push("(תמונה מוקטנת, המקור לא היה זמין)");
  return lines.join("\n");
}

export function alertButtons(alert, senderNumber) {
  const rows = [];
  if (senderNumber) {
    const hello = `היי, ראיתי בקבוצה את ה${alert.summary}. עדיין רלוונטי?`;
    rows.push([{ text: "💬 שלח הודעה למפרסם", url: `https://wa.me/${senderNumber}?text=${encodeURIComponent(hello)}` }]);
  }
  rows.push([
    { text: "👍 מתאים", callback_data: `fb:good:${alert.id}` },
    { text: "👎 לא רלוונטי", callback_data: `fb:bad:${alert.id}` },
  ]);
  return rows;
}

/** המימוש של "notifier" שה-pipeline משתמש בו. */
export function createNotifier({ tg, store, config }) {
  const prefix = () => (config.dryRun ? "[ניסיון] " : "");

  async function sendWithMedia(media, caption, opts) {
    const file = media ? await media.getOriginal().catch(() => null) : null;
    if (!file) return tg.sendText(caption, opts);
    return file.kind === "video" ? tg.sendVideo(file, caption, opts) : tg.sendPhoto(file, caption, opts);
  }

  return {
    async alert({ alert, decision, result, post, media }) {
      const senderNumber = await post.getSenderNumber?.().catch(() => null);
      const file = media ? await media.getOriginal().catch(() => null) : null;
      const caption = formatAlert({
        alert,
        decision,
        result,
        post,
        wants: store.wants,
        groupName: store.group?.name ?? "",
        dryRun: config.dryRun,
        degraded: file?.degraded,
      });
      const opts = { buttons: alertButtons(alert, senderNumber) };
      if (!file) return tg.sendText(caption, opts);
      return file.kind === "video" ? tg.sendVideo(file, caption, opts) : tg.sendPhoto(file, caption, opts);
    },

    followUp(alert, text) {
      return tg.sendText(`${prefix()}📝 ${alert.senderName || "המפרסם"} הוסיף/ה:\n"${text}"`, { replyTo: alert.tgMessageId });
    },

    extraMedia(alert, media) {
      return sendWithMedia(media, `${prefix()}📷 עוד מהפוסט של ${alert.senderName || "המפרסם"}`, { replyTo: alert.tgMessageId });
    },

    gone(alert, { text, media }) {
      const caption = `${prefix()}❌ נמסר: ${alert.summary}${text ? `\n${alert.senderName || "המפרסם"}: "${clip(text, 300)}"` : ""}`;
      return sendWithMedia(media, caption, { replyTo: alert.tgMessageId });
    },

    info(text) {
      return tg.sendText(text);
    },
  };
}

/**
 * מטפל בכל מה שמגיע מטלגרם: פקודות, 👍/👎, והסבר "למה" אחרי 👎.
 * @param {{ tg: Telegram, store: import("./store.js").Store, ctx: object, chatId: string }} deps
 */
export function createController({ tg, store, ctx, chatId }) {
  const pendingNotes = new Map(); // הודעת "למה?" → מזהי משוב

  async function onCallback(cb) {
    if (String(cb.message?.chat?.id) !== String(chatId)) return;
    const [kind, verdict, rawId] = (cb.data || "").split(":");
    if (kind !== "fb") return;
    const alert = store.getAlert(Number(rawId));
    if (!alert) return tg.answerCallback(cb.id, "ההתראה כבר לא שמורה");
    if (alert.feedback) return tg.answerCallback(cb.id, "כבר נרשם 👌");

    store.updateAlert(alert.id, { feedback: verdict });
    const ids = alert.wantIds.map(
      (wantId) =>
        store.addFeedback({ wantId, verdict: verdict === "good" ? "good" : "bad", summary: alert.summary, text: alert.text, imagePath: alert.imagePath }).id,
    );
    if (verdict === "good") return tg.answerCallback(cb.id, "👍 נרשם, אחפש עוד כאלה");

    await tg.answerCallback(cb.id, "👎 נרשם, לא אתריע על כאלה");
    const promptId = await tg.sendText("למה זה לא רלוונטי? ענה להודעה הזו במשפט קצר (אפשר לדלג).", {
      replyTo: alert.tgMessageId,
      forceReply: true,
    });
    pendingNotes.set(promptId, ids);
  }

  async function onMessage(message) {
    const from = String(message.chat.id);
    if (!chatId) {
      console.log(`📌 ה-chat id שלך בטלגרם: ${from}\n   הדבק אותו ב-.env בשורה TELEGRAM_CHAT_ID=${from} והפעל מחדש.`);
      return tg.sendText(`ה-chat id שלך: ${from}\nהדבק אותו בקובץ .env (TELEGRAM_CHAT_ID) והפעל את הבוט מחדש.`, {}, from);
    }
    if (from !== String(chatId)) return; // כל אחד אחר: מתעלמים
    const text = (message.text || "").trim();
    if (!text) return;

    const replyTo = message.reply_to_message?.message_id;
    if (replyTo && pendingNotes.has(replyTo)) {
      for (const id of pendingNotes.get(replyTo)) store.setFeedbackNote(id, text);
      pendingNotes.delete(replyTo);
      return tg.sendText("📝 הבנתי, אתחשב בזה מעכשיו.");
    }

    if (text === "/start") return tg.sendText(HELP);
    const reply = await handleCommand(text, store, ctx);
    return tg.sendText(reply ?? `לא הבנתי 🙂\n\n${HELP}`);
  }

  return {
    async handleUpdate(update) {
      if (update.callback_query) return onCallback(update.callback_query);
      if (update.message) return onMessage(update.message);
    },
  };
}
