// 🤖 בוט ווטסאפ: סורק קבוצות מסירות/מכירות ושולח לך הודעה פרטית כשעולה משהו שאתה מחפש.
import "dotenv/config";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { Store } from "./store.js";
import { findMatches } from "./matcher.js";
import { handleCommand } from "./commands.js";

const { Client, LocalAuth } = pkg;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024; // מגבלת התמונה של Claude היא 5MB
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const store = new Store();
// ההודעות שהבוט עצמו שלח לצ'אט "הודעה לעצמי" — כדי לא לקרוא אותן כפקודות.
const sentByBot = new Set();

const client = new Client({
  authStrategy: new LocalAuth(), // שומר את החיבור בתיקייה .wwebjs_auth — סורקים QR רק פעם אחת
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("📱 סרוק את הקוד: ווטסאפ → הגדרות → מכשירים מקושרים → קישור מכשיר");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log(`✅ מחובר כ-${client.info.pushname}. סורק קבוצות: ${config.groups.join(", ") || "כולן"}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  אין ANTHROPIC_API_KEY — עובד במצב מילות מפתח בלבד.");
  }
  await notifyMe(`🤖 הבוט פועל! שלח *!עזרה* כדי לראות את הפקודות.\nחיפושים פעילים: ${store.wants.length}`);
});

client.on("auth_failure", (m) => console.error("❌ החיבור נכשל:", m));
client.on("disconnected", (reason) => {
  console.error("🔌 התנתק:", reason);
  process.exit(1); // מנהל התהליך (pm2/docker) יפעיל מחדש
});

// message_create תופס גם הודעות שאני שולח — ככה מקבלים פקודות מ"הודעה לעצמי".
client.on("message_create", (msg) => {
  if (!msg.fromMe || msg.isForwarded || !isSelfChat(msg) || sentByBot.has(msg.id._serialized)) return;
  enqueue(() => onCommand(msg));
});

// message תופס רק הודעות שאחרים שלחו.
client.on("message", (msg) => {
  if (!msg.from.endsWith("@g.us") || store.paused || !store.wants.length) return;
  enqueue(() => onGroupMessage(msg));
});

function isSelfChat(msg) {
  return msg.to === msg.from || msg.to === client.info.wid._serialized;
}

async function onCommand(msg) {
  const reply = await handleCommand(msg.body, store, { listGroups });
  if (reply) await notifyMe(reply);
}

async function onGroupMessage(msg) {
  const chat = await msg.getChat();
  if (!isWatchedGroup(chat.name)) return;

  const text = (msg.body || "").trim();
  const image = await getImage(msg);
  if (!image && text.length < config.minTextLength) return;

  let matches;
  try {
    matches = await findMatches({ text, image }, store.wants);
  } catch (err) {
    console.error("שגיאה בבדיקת הודעה:", err.message);
    return;
  }
  if (!matches.length) return;

  const contact = await msg.getContact();
  const sender = contact.pushname || contact.number || "לא ידוע";
  const lines = matches.map((m) => {
    const want = store.wants.find((w) => w.id === m.id);
    return `• *${want?.text ?? m.id}* — ${m.reason}`;
  });
  console.log(`🎯 התאמה ב-${chat.name}: ${lines.join(" | ")}`);

  await notifyMe(
    `🎯 *מצאתי משהו בשבילך!*\n` +
      `📍 קבוצה: ${chat.name}\n` +
      `👤 מפרסם: ${sender}${contact.number ? ` (wa.me/${contact.number})` : ""}\n\n` +
      `${lines.join("\n")}\n\n` +
      `📝 ${text || "(תמונה בלבד)"}`,
  );
  if (config.forwardOriginal) {
    await msg.forward(client.info.wid._serialized);
  }
}

function isWatchedGroup(name = "") {
  if (!config.groups.length) return true;
  return config.groups.some((g) => name.includes(g));
}

async function getImage(msg) {
  if (!config.analyzeImages || !process.env.ANTHROPIC_API_KEY || msg.type !== "image") return undefined;
  try {
    const media = await msg.downloadMedia();
    if (!media || !IMAGE_TYPES.has(media.mimetype)) return undefined;
    if ((media.data.length * 3) / 4 > MAX_IMAGE_BYTES) return undefined;
    return { mimetype: media.mimetype, data: media.data };
  } catch {
    return undefined; // תמונה שכבר לא זמינה להורדה — ממשיכים עם הטקסט בלבד
  }
}

async function listGroups() {
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup).map((c) => c.name);
  if (!groups.length) return "לא מצאתי קבוצות.";
  const lines = groups.map((name) => `${isWatchedGroup(name) ? "✅" : "▫️"} ${name}`);
  return `👥 *הקבוצות שלך* (✅ = נסרקת):\n${lines.join("\n")}\n\nלשינוי: ערוך את groups בקובץ config.js`;
}

async function notifyMe(text) {
  const sent = await client.sendMessage(client.info.wid._serialized, text);
  sentByBot.add(sent.id._serialized);
}

// טיפול בהודעות אחת-אחת, כדי שקבוצה עמוסה לא תשלח עשרות בקשות במקביל.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((err) => console.error("שגיאה:", err));
}

client.initialize();
