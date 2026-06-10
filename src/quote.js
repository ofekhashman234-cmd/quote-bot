// 🧠 הסוכן: לוקח את פרטי הליד + המחירון, ומחזיר הצעת מחיר מובנית (JSON) מ-Claude.
import Anthropic from "@anthropic-ai/sdk";
import { business } from "../config/business.js";
import { pricing } from "../config/pricing.js";

const client = new Anthropic(); // קורא את ANTHROPIC_API_KEY מהסביבה

// מבנה ההצעה שאנחנו דורשים מ-Claude להחזיר (structured output).
const quoteSchema = {
  type: "object",
  properties: {
    client_name: { type: "string", description: "שם הלקוח / העסק" },
    intro: {
      type: "string",
      description: "פסקת פתיחה אישית וחמה בעברית, 2-3 משפטים, פונה ללקוח בשמו",
    },
    line_items: {
      type: "array",
      description: "שורות הצעת המחיר",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "תיאור הפריט/השירות" },
          quantity: { type: "integer", description: "כמות" },
          unit_price: { type: "number", description: "מחיר ליחידה" },
          total: { type: "number", description: "סה\"כ לשורה" },
        },
        required: ["description", "quantity", "unit_price", "total"],
        additionalProperties: false,
      },
    },
    subtotal: { type: "number", description: "סכום ביניים לפני הנחה" },
    discount: { type: "number", description: "הנחה בשקלים (0 אם אין)" },
    total: { type: "number", description: "סה\"כ לתשלום אחרי הנחה" },
    currency: { type: "string", description: "סימן המטבע, למשל ₪" },
    timeline: { type: "string", description: "לוח זמנים משוער לביצוע" },
    payment_terms: { type: "string", description: "תנאי תשלום" },
    validity_days: { type: "integer", description: "מספר ימים שההצעה תקפה" },
    notes: { type: "string", description: "הערות נוספות (אפשר ריק)" },
  },
  required: [
    "client_name",
    "intro",
    "line_items",
    "subtotal",
    "discount",
    "total",
    "currency",
    "timeline",
    "payment_terms",
    "validity_days",
    "notes",
  ],
  additionalProperties: false,
};

function buildSystemPrompt() {
  const priceList = JSON.stringify(pricing.services, null, 2);
  return `אתה כותב הצעות מחיר מקצועיות בעברית עבור העסק של ${business.name} (${business.tagline}).

המחירון שלך (כל המחירים בשקלים, לפני מע"מ):
${priceList}

הנחיות תמחור:
${pricing.notes}

כללים:
- בנה הצעת מחיר מותאמת בדיוק לפי מה שהליד צריך, על בסיס המחירון שלמעלה.
- בחר את השירות המתאים והוסף תוספות רלוונטיות לפי הדרישות והפרטים מהשיחה.
- אל תנפח מחירים. היצמד למחירון, אל תוסיף תוספות שלא נדרשו במפורש, וכשמצוין טווח מחיר — העדף את הצד הנמוך אלא אם הדרישות באמת מצדיקות יותר.
- אם הליד מבקש כמות (למשל כמה סרטונים) — חשב לפי הכמות × מחיר היחידה מהמחירון.
- אם הליד ציין תקציב, נסה להתאים את ההצעה אליו בצורה הגיונית (בלי לרדת מתחת למחיר סביר).
- כתוב פסקת פתיחה (intro) חמה ואישית בעברית שפונה ללקוח בשמו.
- חשב נכון: total של כל שורה = quantity × unit_price. subtotal = סכום כל השורות. total = subtotal − discount.
- המטבע הוא "${business.currency}".
- אם לא צוין אחרת: תוקף ${business.defaultValidityDays} ימים, תנאי תשלום "${business.defaultPaymentTerms}".
- תן לוח זמנים (timeline) ריאלי לפי היקף הפרויקט.
- כתוב בעברית תקנית, מקצועית וברורה. החזר אך ורק את ה-JSON לפי הסכמה.`;
}

/**
 * מקבל אובייקט עם פרטי הליד ומחזיר הצעת מחיר מובנית.
 * @param {Object} lead - { clientName, projectType, requirements, budget, deadline, notes }
 * @returns {Promise<Object>} הצעת המחיר לפי quoteSchema
 */
export async function generateQuote(lead) {
  const userMessage = [
    `שם הלקוח/העסק: ${lead.clientName || "—"}`,
    `סוג הפרויקט: ${lead.projectType || "—"}`,
    `דרישות: ${lead.requirements || "—"}`,
    `תקציב משוער של הליד: ${lead.budget || "לא צוין"}`,
    `דדליין / לוח זמנים מבוקש: ${lead.deadline || "לא צוין"}`,
    `פרטים נוספים מהשיחה: ${lead.notes || "—"}`,
  ].join("\n");

  const response = await client.messages.create({
    model: business.model,
    max_tokens: 4000,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: { type: "json_schema", schema: quoteSchema },
    },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("לא התקבל פלט טקסט מ-Claude");
  return JSON.parse(textBlock.text);
}
