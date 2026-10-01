// 🧠 מחליט אם פוסט בקבוצה מתאים לאחד הדברים שאתה מחפש.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const matchSchema = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      description: "החיפושים שהפוסט מתאים להם. ריק אם אין התאמה.",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "מספר החיפוש מהרשימה" },
          reason: { type: "string", description: "הסבר קצר מאוד בעברית למה זה מתאים" },
        },
        required: ["id", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `אתה עוזר שסורק הודעות בקבוצות ווטסאפ של מסירות ומכירות יד שנייה בישראל.
תקבל רשימת דברים שהמשתמש מחפש, והודעה אחת מהקבוצה (טקסט ולפעמים תמונה).
החלט לאילו חיפושים ההודעה מתאימה.

כללים:
- התאמה = ההודעה מציעה (מוסרת או מוכרת) פריט שעונה על החיפוש. גם מילים נרדפות, איות שונה וסלנג נחשבים (למשל "ספה" ו"סלון", "מקרר" ו"מקרר מקפיא").
- אם בחיפוש יש תנאים (מחיר מקסימלי, אזור, מידה, מצב) — התאם רק אם ההודעה לא סותרת אותם. אם ההודעה לא מציינת את הפרט — זה עדיין מתאים.
- הודעה שמישהו *מבקש* פריט ("מחפש/ת...", "למישהו יש...") אינה התאמה.
- הודעות כמו "נמסר", "תודה", פרסומות לא קשורות — אינן התאמה.
- כשיש ספק אמיתי והפריט קרוב מאוד למה שמחפשים — עדיף להתאים מאשר לפספס.
- reason: עד 10 מילים.`;

/**
 * @param {{text: string, image?: {mimetype: string, data: string}}} post
 * @param {{id: number, text: string}[]} wants
 * @returns {Promise<{id: number, reason: string}[]>}
 */
export async function findMatches(post, wants) {
  if (!wants.length) return [];
  if (!client) return keywordMatches(post.text, wants);

  const wantsList = wants.map((w) => `${w.id}. ${w.text}`).join("\n");
  const content = [];
  if (post.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: post.image.mimetype, data: post.image.data },
    });
  }
  content.push({
    type: "text",
    text: `רשימת החיפושים:\n${wantsList}\n\nההודעה מהקבוצה:\n${post.text || "(אין טקסט, רק תמונה)"}`,
  });

  const response = await client.beta.messages.create({
    model: config.model,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    output_config: {
      effort: config.effort,
      format: { type: "json_schema", schema: matchSchema },
    },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") return [];
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) return [];
  const { matches } = JSON.parse(textBlock.text);
  const validIds = new Set(wants.map((w) => w.id));
  return matches.filter((m) => validIds.has(m.id));
}

// מילים שלא אומרות כלום על הפריט עצמו.
const STOPWORDS = new Set(["עד", "של", "עם", "בלי", "או", "גם", "רק", "אזור", "באזור", "מצב", "טוב", "חדש", "ש״ח", "שח", "ש\"ח"]);

/**
 * מצב גיבוי בלי AI: מתאים אם מילה משמעותית מהחיפוש מופיעה בהודעה.
 * (בדיקת "מכיל" ולא מילה שלמה, כדי לתפוס תחיליות כמו "הספה", "לספה".)
 */
export function keywordMatches(text, wants) {
  const haystack = (text || "").toLowerCase();
  if (!haystack) return [];
  return wants
    .filter((w) =>
      w.text
        .toLowerCase()
        .split(/[\s,.\-/]+/)
        .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
        .some((word) => haystack.includes(word)),
    )
    .map((w) => ({ id: w.id, reason: "מילת מפתח תואמת" }));
}
