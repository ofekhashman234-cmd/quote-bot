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

המחירון שלך (כל המחירים בשקלים ו**כוללים מע"מ** — אלה מחירים סופיים):
${priceList}

הנחיות תמחור:
${pricing.notes}

כללים:
- בנה הצעת מחיר מותאמת בדיוק לפי מה שהליד צריך, על בסיס המחירון שלמעלה.

שורות הפירוט (line_items) — חשוב מאוד:
- צור **שורה אחת בלבד** עבור השירות המבוקש (ברירת מחדל). פצל לכמה שורות רק אם הליד ביקש במפורש כמה שירותים שונים.
- **אסור להמציא תוספות או רכיבים שהלקוח לא ביקש במפורש** (למשל "מושן גרפיקס", "אנימציית טקסט", "גרסה נוספת" וכו'). אל תוסיף שום דבר שלא נאמר בדרישות.
- **התיאור חייב להיות קצר ומדויק — שורה אחת בלבד** (עד ~12 מילים). תאר את המוצר בתמציתיות, בלי פסקאות ארוכות ובלי לפרט כל רכיב.
- אם הליד מבקש כמות (למשל כמה סרטונים) — שקף את הכמות בשדה quantity.

סבבי תיקונים — אסור לכתוב:
- אל תזכיר סבבי תיקונים / מספר תיקונים בשום מקום (לא ב-notes, לא ב-intro, לא בתיאור). זה מופיע אוטומטית בהצעה כשורה קבועה. אם תכתוב על תיקונים — תיווצר סתירה.

מע"מ:
- כל המחירים כוללים מע"מ. אל תחשב, תוסיף או "תפצל" מע"מ. אל תכתוב ניסוחי מע"מ ("לפני מע\"מ" / "+ מע\"מ" וכו') בשום מקום, ואל תזכיר מע"מ ב-notes או ב-intro.

מחירים:
- מלא את unit_price/total/subtotal/discount/total לפי המחירון כנקודת התחלה סבירה — אבל דע שהמספרים הכספיים הסופיים ייקבעו אוטומטית במערכת לפי "המחיר הסופי" וההנחה שאופק מזין. לכן התמקד בעיקר בתיאור מדויק, בלשון נכונה, בלוח זמנים ובתנאים. אל תמציא הנחה מעצמך — discount=0 אלא אם תקבל הנחה מפורשת.

לשון פנייה (זכר/נקבה):
- כתוב את ה-intro וכל ניסוח שמתייחס ללקוח בלשון שצוינה בשדה "לשון פנייה". הקפד על התאמה דקדוקית מלאה (פעלים, תארים, כינויים).

- כתוב פסקת פתיחה (intro) חמה ואישית בעברית שפונה ללקוח בשמו ובלשון הנכונה.
- המטבע הוא "${business.currency}".
- אם לא צוין אחרת: תוקף ${business.defaultValidityDays} ימים, תנאי תשלום "${business.defaultPaymentTerms}".
- לוח זמנים (timeline): אם אופק ציין לוח זמנים — **חובה להיצמד בדיוק למה שכתב** (אותו משך/תנאי, למשל "עד שבוע לסרטון" או "יומיים"). אל תשנה, אל תקצר ואל תאריך את המשך שצוין; מותר רק לנסח אותו יפה. רק אם לא צוין לוח זמנים — תן הערכה ריאלית לפי היקף הפרויקט.
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
    `לשון פנייה ללקוח: ${lead.gender || "זכר"}`,
    `סוג הפרויקט: ${lead.projectType || "—"}`,
    `דרישות: ${lead.requirements || "—"}`,
    `מחיר סופי ללקוח (לידיעה — לקביעת היקף; הסכומים ייקבעו במערכת): ${lead.finalPrice || "לא צוין"}`,
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
  const quote = JSON.parse(textBlock.text);
  return applyFinalPricing(quote, lead);
}

// ממיר טקסט כמו "1,000 ₪" או "1000" למספר.
function parseNum(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
  return isNaN(n) ? NaN : n;
}

/**
 * קובע את הכספים באופן דטרמיניסטי (לא ע"י ה-AI):
 * - "מחיר סופי" שאופק הזין = הסה"כ לתשלום בפועל (הלקוח לא משלם יותר מזה).
 * - הנחה (אחוז/סכום) מוצגת "מעל" המחיר: סכום הביניים מנופח כך שאחרי ההנחה
 *   מגיעים בדיוק למחיר הסופי. כך הלקוח רואה שקיבל הנחה, ואופק מקבל את מלוא המחיר.
 * - שורות הפירוט מותאמות כך שסכומן = סכום הביניים.
 */
function applyFinalPricing(quote, lead = {}) {
  const items = Array.isArray(quote.line_items) ? quote.line_items : [];
  const naturalRaw = items.reduce((s, it) => s + (Number(it.total) || 0), 0);

  const dType = lead.discountType || "none"; // none | percent | amount
  const dVal = parseNum(lead.discountValue) || 0;
  const final = parseNum(lead.finalPrice);

  let total, subtotal, discount;

  if (!isNaN(final) && final > 0) {
    total = Math.round(final);
    if (dType === "percent" && dVal > 0 && dVal < 100) {
      subtotal = Math.round(total / (1 - dVal / 100));
      discount = subtotal - total;
    } else if (dType === "amount" && dVal > 0) {
      subtotal = total + Math.round(dVal);
      discount = Math.round(dVal);
    } else {
      subtotal = total;
      discount = 0;
    }
  } else {
    // אין מחיר סופי — נשען על מה שה-AI הציע מהמחירון.
    subtotal = Math.round(naturalRaw);
    if (dType === "percent" && dVal > 0 && dVal < 100) discount = Math.round(subtotal * (dVal / 100));
    else if (dType === "amount" && dVal > 0) discount = Math.round(dVal);
    else discount = 0;
    total = subtotal - discount;
  }

  // התאמת שורות הפירוט כך שסכומן = subtotal.
  if (items.length) {
    let acc = 0;
    items.forEach((it, i) => {
      const qty = Number(it.quantity) || 1;
      const weight = naturalRaw > 0 ? (Number(it.total) || 0) / naturalRaw : 1 / items.length;
      let lineTotal = i === items.length - 1 ? subtotal - acc : Math.round(subtotal * weight);
      acc += lineTotal;
      it.total = lineTotal;
      it.unit_price = Math.round(lineTotal / qty);
      it.quantity = qty;
    });
  } else {
    quote.line_items = [
      { description: "השירות המבוקש", quantity: 1, unit_price: subtotal, total: subtotal },
    ];
  }

  quote.subtotal = subtotal;
  quote.discount = discount;
  quote.total = total;
  quote.currency = quote.currency || business.currency;
  return quote;
}
