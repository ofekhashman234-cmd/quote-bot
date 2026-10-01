// 🤖 בוט המסירות: סורק קבוצת ווטסאפ אחת ושולח לך לטלגרם, תוך שניות, פריטים שאתה מחפש.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { Store } from "./store.js";
import { classify } from "./matcher.js";
import { createPipeline, createLimiter } from "./pipeline.js";
import { createMediaLoader } from "./media.js";
import { Telegram, createNotifier, createController } from "./telegram.js";

const { Client, LocalAuth } = pkg;

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("❌ חסר TELEGRAM_BOT_TOKEN בקובץ .env (ראה README → הגדרת טלגרם).");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠️  אין ANTHROPIC_API_KEY: עובד במצב מילות מפתח בלבד (בלי הבנת תמונות).");
}

const chatId = process.env.TELEGRAM_CHAT_ID || "";
const store = new Store();
const tg = new Telegram({ token: process.env.TELEGRAM_BOT_TOKEN, chatId });
const notifier = createNotifier({ tg, store, config });

const IMAGES_DIR = path.resolve("data/images");
function saveImage(alertId, image) {
  try {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const file = path.join(IMAGES_DIR, `alert-${alertId}.jpg`);
    fs.writeFileSync(file, Buffer.from(image.data, "base64"));
    return file;
  } catch {
    return null;
  }
}

const pipeline = createPipeline({
  store,
  notifier,
  config,
  saveImage,
  classify: (post, wants, feedback) => classify(post, wants, feedback, { model: config.model, effort: config.effort }),
});
const limit = createLimiter(config.concurrency);

const wa = new Client({
  authStrategy: new LocalAuth(), // החיבור נשמר ב-.wwebjs_auth, סורקים QR פעם אחת
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});
let waReady = false;

// ── ווטסאפ → הצינור ──

function toPost(msg, { late = false } = {}) {
  const author = msg.author || msg.from;
  const kind = msg.type === "chat" ? "text" : msg.type === "image" || msg.type === "video" ? msg.type : "other";
  return {
    id: msg.id._serialized,
    stanzaId: msg.id.id,
    chatId: msg.from,
    isGroup: msg.from.endsWith("@g.us"),
    fromMe: msg.fromMe,
    isStatus: msg.isStatus || msg.from === "status@broadcast",
    senderId: author,
    senderName: msg._data?.notifyName || "",
    ts: (msg.timestamp || Date.now() / 1000) * 1000,
    text: msg.body || "",
    kind,
    quotedStanzaId: msg.hasQuotedMsg ? msg._data?.quotedStanzaID || null : null,
    loadMedia: createMediaLoader(msg, { aiImageSize: config.aiImageSize }),
    getSenderNumber: async () => {
      if (author.endsWith("@c.us")) return author.split("@")[0];
      // מספר מוסתר (LID): מנסים לברר את המספר האמיתי. אם אין, ההתראה תהיה בלי כפתור צ'אט.
      const [res] = await wa.getContactLidAndPhone([author]);
      return res?.pn ? res.pn.split("@")[0] : null;
    },
    late,
  };
}

function onWaMessage(msg, opts) {
  // סינון זול לפני כל דבר אחר: רק הקבוצה שנבחרה.
  if (!store.group || msg.from !== store.group.id) return;
  limit(() => pipeline.handleMessage(toPost(msg, opts))).catch((err) => console.error("שגיאה בטיפול בהודעה:", err));
}

wa.on("qr", (qr) => {
  console.log("📱 סרוק: ווטסאפ → הגדרות → מכשירים מקושרים → קישור מכשיר");
  qrcode.generate(qr, { small: true });
});

wa.on("ready", async () => {
  waReady = true;
  console.log(`✅ ווטסאפ מחובר (${wa.info.pushname}). קבוצה: ${store.group?.name ?? "לא נבחרה"}`);
  if (chatId) {
    await tg
      .sendText(
        `🤖 הבוט פועל${config.dryRun ? " (מצב ניסיון)" : ""}.\nקבוצה: ${store.group?.name ?? "לא נבחרה, שלח: קבוצות"}\nחיפושים: ${store.wants.length}`,
      )
      .catch((err) => console.error("לא הצלחתי לשלוח לטלגרם:", err.message));
  }
  await catchUp();
});

// השלמה אחרי ניתוק: פוסטים שעלו בזמן שהבוט לא היה מחובר.
async function catchUp() {
  if (!store.group || !store.lastSeenTs) return;
  try {
    const chat = await wa.getChatById(store.group.id);
    const msgs = await chat.fetchMessages({ limit: 30 });
    const missed = msgs.filter((m) => !m.fromMe && m.timestamp * 1000 > store.lastSeenTs);
    if (missed.length) console.log(`⏱️ משלים ${missed.length} הודעות שפוספסו`);
    for (const m of missed) onWaMessage(m, { late: true });
  } catch (err) {
    console.error("השלמת הודעות נכשלה:", err.message);
  }
}

wa.on("message", (msg) => onWaMessage(msg));
wa.on("auth_failure", (m) => console.error("❌ החיבור לווטסאפ נכשל:", m));
wa.on("disconnected", (reason) => {
  console.error("🔌 ווטסאפ התנתק:", reason);
  process.exit(1); // pm2 מפעיל מחדש
});

// ── טלגרם ──

let groupChoices = [];
const ctx = {
  async listGroups() {
    if (!waReady) return "⏳ ווטסאפ עוד מתחבר, נסה שוב בעוד רגע.";
    const chats = await wa.getChats();
    groupChoices = chats.filter((c) => c.isGroup && !c.isReadOnly);
    if (!groupChoices.length) return "לא מצאתי קבוצות.";
    const lines = groupChoices.map((c, i) => `${i + 1}. ${c.id._serialized === store.group?.id ? "✅ " : ""}${c.name}`);
    return `👥 הקבוצות שלך:\n${lines.join("\n")}\n\nלבחירה: בחר <מספר>`;
  },
  async selectGroup(n) {
    const chat = groupChoices[n - 1];
    if (!chat) return "❓ שלח קודם: קבוצות, ואז בחר מספר מהרשימה.";
    store.setGroup({ id: chat.id._serialized, name: chat.name });
    store.setLastSeen(Date.now()); // לא סורקים היסטוריה ישנה, רק מעכשיו
    return `✅ סורק רק את: ${chat.name}\nצ'אטים פרטיים וקבוצות אחרות לא נבדקים.`;
  },
  status() {
    return [
      `📊 סטטוס`,
      `ווטסאפ: ${waReady ? "מחובר" : "לא מחובר"}`,
      `קבוצה: ${store.group?.name ?? "לא נבחרה"}`,
      `חיפושים: ${store.wants.length}${store.paused ? " (מושהה)" : ""}`,
      `מודל: ${config.model}${config.dryRun ? " · מצב ניסיון" : ""}`,
      `הוצאה היום: $${store.spentToday().toFixed(3)} מתוך $${config.dailyBudgetUsd}`,
    ].join("\n");
  },
};
const controller = createController({ tg, store, ctx, chatId });
tg.poll((update) => controller.handleUpdate(update));

// ── סימן חיים (healthchecks.io) ──
if (process.env.HEALTHCHECK_URL) {
  setInterval(() => {
    if (waReady) fetch(process.env.HEALTHCHECK_URL).catch(() => {});
  }, 60 * 1000);
}

if (!chatId) console.log("📌 שלח /start לבוט שלך בטלגרם כדי לקבל את ה-chat id.");
wa.initialize().catch((err) => {
  console.error(`❌ לא הצלחתי להתחבר לווטסאפ ווב: ${err.message}\n   בדוק חיבור לאינטרנט. pm2 ינסה שוב אוטומטית.`);
  process.exit(1);
});
