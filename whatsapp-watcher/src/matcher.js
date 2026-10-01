// 🧠 מסווג פוסט מהקבוצה: מוסר/מוכר, מבקש, עדכון "נמסר" או לא קשור, ולאילו חיפושים הוא מתאים.
import Anthropic from "@anthropic-ai/sdk";

// מחירים לדולר למיליון טוקנים, לחישוב התקרה היומית.
const PRICING = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const classifySchema = {
  type: "object",
  properties: {
    post_type: {
      type: "string",
      enum: ["offer", "request", "gone_update", "other"],
      description: "offer = מוסר/מוכר פריט. request = מחפש/מבקש פריט. gone_update = הודעה שפריט נמסר/נמכר. other = כל השאר",
    },
    item_summary: { type: "string", description: "שם קצר של הפריט, עד 6 מילים. ריק אם אין פריט" },
    price: { type: "string", description: "\"חינם\", מחיר כמו \"350 ₪\", או ריק אם לא צוין" },
    location: { type: "string", description: "עיר/אזור אם צוין, אחרת ריק" },
    matches: {
      type: "array",
      description: "החיפושים שהפריט המוצע מתאים להם. ריק אם post_type אינו offer",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "מספר החיפוש" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", description: "עד 10 מילים בעברית" },
        },
        required: ["id", "confidence", "reason"],
        additionalProperties: false,
      },
    },
    gone: {
      type: "object",
      description: "רק כשיש רשימת פריטים קודמים מהמפרסם: האם ההודעה מסמנת שאחד מהם נמסר",
      properties: {
        previous_index: { type: "integer", description: "מספר הפריט הקודם שנמסר, או -1" },
        certain: { type: "boolean", description: "true רק אם ברור לגמרי (X על אותו פריט, או כתוב נמסר עליו)" },
      },
      required: ["previous_index", "certain"],
      additionalProperties: false,
    },
  },
  required: ["post_type", "item_summary", "price", "location", "matches", "gone"],
  additionalProperties: false,
};

const RULES = `אתה סורק הודעות בקבוצת ווטסאפ של מסירות ומכירות יד שנייה בישראל, עבור משתמש אחד שמחפש פריטים מסוימים.
המהירות קריטית: ענה מהר, בלי הסברים מעבר לנדרש.

סוג ההודעה (post_type):
- offer: מישהו **מציע** פריט: מוסר, מוכר, "למסירה", "נותן", "מפנה דירה", או תמונה של פריט בלי טקסט (בקבוצת מסירות זו כמעט תמיד הצעה).
- request: מישהו **מחפש או מבקש** פריט: "מחפש/ת", "מישהו מוסר...?", "יש למישהו...?", "צריך/ה", "דרוש", "מעוניין לקנות", "רלוונטי לי", "עגלה כזו מחפשת" (גם עם תמונה!).
  חשוב מאוד: בקשה היא אף פעם לא התאמה, גם אם הפריט המבוקש זהה לחיפוש של המשתמש.
- gone_update: "נמסר", "נמכר", "נלקח", "לא רלוונטי", תמונה עם X גדול על הפריט.
- other: תודות, שאלות על פוסטים, חוקי הקבוצה, כל השאר.

התאמות (matches), רק ל-offer:
- התאם כשהפריט המוצע עונה על החיפוש. מילים נרדפות וסלנג נחשבים ("סלון 3+2" = ספה, "בייק חשמלי" = אופניים חשמליים).
- אם בחיפוש יש תנאים (מחיר מקסימלי, אזור, סוג) והפוסט **סותר** אותם, אל תתאים. אם הפוסט לא מציין את הפרט, זה עדיין מתאים.
  "אזור המרכז" = גוש דן, השרון, השפלה וסביבתם (תל אביב, רמת גן, גבעתיים, חולון, בת ים, פתח תקווה, ראשון לציון, הרצליה, רחובות, נס ציונה וכו').
- confidence:
  high = ברור שזה הפריט.
  medium = כנראה, אבל חסר מידע (קופסה סגורה, תמונה מטושטשת, פריט קרוב).
  low = קשר רחוק.
- פריט דומה אבל שונה (כורסה מול ספה, אופניים רגילים מול חשמליים, עגלת קניות מול עגלת תינוק) אינו high.
- בתמונה: זהה את כל הפריטים שרואים, קרא טקסט בצילומי מסך, ושים לב לסימון X.`;

/**
 * בונה את חלק הפרומפט שלא משתנה בין פוסטים (נשמר ב-cache): הכללים, החיפושים ומה שהמשתמש לימד.
 */
export function buildSystemPrompt(wants, feedback = []) {
  const wantLines = wants.map((w) => {
    const examples = feedback
      .filter((f) => f.wantId === w.id)
      .map((f) => {
        const what = `"${f.summary || f.text}"`;
        const note = f.note ? ` (הערת המשתמש: ${f.note})` : "";
        if (f.verdict === "bad") return `   - בעבר ${what} → המשתמש אמר: לא רלוונטי${note}`;
        if (f.verdict === "missed") return `   - בעבר ${what} → פספסת, היה צריך להתאים${note}`;
        return `   - בעבר ${what} → המשתמש אישר: מתאים${note}`;
      });
    return [`${w.id}. ${w.text}`, ...examples].join("\n");
  });
  return `${RULES}

החיפושים של המשתמש (ותחתיהם מה שלמדת מהמשוב שלו, התחשב בזה מאוד):
${wantLines.join("\n")}`;
}

// ── זיהוי מהיר בלי AI ──

// גבולות מילה בעברית (\b של JavaScript לא עובד עם אותיות עבריות).
const B = "(?:^|[^\\u05D0-\\u05EA])";
const E = "(?![\\u05D0-\\u05EA])";
const word = (w) => new RegExp(`${B}(?:${w})${E}`);

// רק ביטויים חד-משמעיים. "צריך" או "מי רוצה?" מופיעים גם בהצעות ("צריך לפנות עד מחר"), ולכן לא כאן.
const REQUEST_PATTERNS = [
  word("מחפש|מחפשת|מחפשים|מחפשות"),
  word("למישהו יש|יש למישהו|אם למישהו|מישהו נתקל"),
  /מישהו (?:מוסר|מוסרת|מוכר|מוכרת)[^.!\n]*\?/,
  word("יש מצב שמישהו|יש מצב מישהו"),
  word("מעוניין לקנות|מעוניינת לקנות|מעוניינים לקנות"),
  word("דרוש|דרושה|דרושים"),
  word("בקשה"),
  word("רלוונטי לי"),
];

/** האם הטקסט נשמע כמו בקשה ("מחפש", "יש למישהו..."). הגנה נוספת על החלטת ה-AI. */
export function looksLikeRequest(text = "") {
  const t = text.trim();
  return Boolean(t) && REQUEST_PATTERNS.some((re) => re.test(t));
}

const GONE_WORDS = word("נמסר|נמסרה|נמסרו|נמכר|נמכרה|נמכרו|נלקח|נלקחה|נלקחו|לא רלוונטי");
const STILL_MORE = /יש עוד|נשאר|עוד אחד|עוד אחת|עדיין יש/;

/** טקסט שמודיע בוודאות שפריט נמסר ("נמסר, תודה"). לא שאלה ולא "נמסר, יש עוד". */
export function isGoneText(text = "") {
  const t = text.trim();
  return GONE_WORDS.test(t) && !STILL_MORE.test(t) && !t.includes("?");
}

// ── הסיווג עצמו ──

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export function costOf(model, usage = {}) {
  const p = PRICING[model] || PRICING["claude-opus-5-5"];
  const input =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) * 1.25 +
    (usage.cache_read_input_tokens || 0) * 0.1;
  return (input * p.input + (usage.output_tokens || 0) * p.output) / 1e6;
}

/**
 * @param {{text: string, image?: {mimetype: string, data: string}, previous?: string[]}} post
 * @param {{id: number, text: string}[]} wants
 * @param {object[]} feedback
 * @param {{model: string, effort?: string}} opts
 * @returns {Promise<{result: object, costUsd: number, ms: number}>}
 */
export async function classify(post, wants, feedback, opts) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { result: keywordClassify(post.text, wants), costUsd: 0, ms: 0 };
  }

  const content = [];
  if (post.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: post.image.mimetype, data: post.image.data },
    });
  }
  const previous = post.previous?.length
    ? `פריטים שהמפרסם הזה הציע לאחרונה (לבדיקה אם ההודעה מסמנת שאחד מהם נמסר):\n${post.previous
        .map((p, i) => `${i}. ${p}`)
        .join("\n")}\n\n`
    : "";
  content.push({ type: "text", text: `${previous}ההודעה:\n${post.text || "(תמונה בלבד, בלי טקסט)"}` });

  const isHaiku = opts.model.startsWith("claude-haiku");
  const params = {
    model: opts.model,
    max_tokens: 1500,
    system: [{ type: "text", text: buildSystemPrompt(wants, feedback), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: isHaiku
      ? { format: { type: "json_schema", schema: classifySchema } }
      : { effort: opts.effort || "low", format: { type: "json_schema", schema: classifySchema } },
  };

  const started = Date.now();
  const response = isHaiku
    ? await getClient().messages.create(params)
    : await getClient().beta.messages.create({
        ...params,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
  const ms = Date.now() - started;
  const costUsd = costOf(opts.model, response.usage);

  if (response.stop_reason === "refusal") return { result: emptyResult("other"), costUsd, ms };
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) return { result: emptyResult("other"), costUsd, ms };

  const result = JSON.parse(textBlock.text);
  const validIds = new Set(wants.map((w) => w.id));
  result.matches = (result.matches || []).filter((m) => validIds.has(m.id));
  return { result, costUsd, ms };
}

function emptyResult(postType) {
  return { post_type: postType, item_summary: "", price: "", location: "", matches: [], gone: { previous_index: -1, certain: false } };
}

// ── מצב גיבוי בלי מפתח API ──

const STOPWORDS = new Set(["עד", "של", "עם", "בלי", "או", "גם", "רק", "אזור", "באזור", "מצב", "טוב", "חדש", "ש״ח", "שח", 'ש"ח', "המרכז"]);

/** מתאים אם מילה משמעותית מהחיפוש מופיעה בהודעה (בדיקת "מכיל", כדי לתפוס "הספה", "לספה"). */
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
    .map((w) => ({ id: w.id, confidence: "medium", reason: "מילת מפתח תואמת" }));
}

function keywordClassify(text, wants) {
  if (isGoneText(text)) return emptyResult("gone_update");
  if (looksLikeRequest(text)) return emptyResult("request");
  const matches = keywordMatches(text, wants);
  return { ...emptyResult(matches.length ? "offer" : "other"), matches };
}
