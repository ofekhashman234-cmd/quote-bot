// 💬 פקודות שאתה שולח לבוט בטלגרם. אפשר עם "!" או "/" בהתחלה, או בלי.
export const HELP = `🤖 פקודות:

חפש <מה אתה מחפש> — הוספת חיפוש
   למשל: חפש ספה תלת מושבית עד 800 ש״ח באזור המרכז
רשימה — מה אני מחפש כרגע
מחק <מספר> — מחיקת חיפוש (או: מחק הכל)

קבוצות — הקבוצות שלך בווטסאפ
בחר <מספר> — הקבוצה שאני סורק (רק אחת)

דוגמאות — מה למדתי מהמשוב שלך
פספסת <מספר חיפוש> <מה היה> — לימוד על פריט שפספסתי
מחק דוגמה <מספר> — מחיקת דוגמה

השהה / המשך — עצירה וחידוש של ההתראות
סטטוס — מצב הבוט והוצאה היום
עזרה — ההודעה הזו

👍/👎 על התראה מלמדים אותי מה מתאים לך.`;

/**
 * מפענח פקודה ומבצע אותה. מחזיר את התשובה, או null אם זו לא פקודה מוכרת.
 * @param {string} body
 * @param {import("./store.js").Store} store
 * @param {{ listGroups: () => Promise<string>, selectGroup: (n: number) => Promise<string>, status?: () => string }} ctx
 */
export async function handleCommand(body, store, ctx) {
  const text = (body || "").trim().replace(/^[!/]/, "").trim();
  if (!text) return null;
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "חפש":
    case "הוסף": {
      if (!arg) return "✏️ כתוב מה לחפש, למשל: חפש אופניים חשמליים";
      const want = store.add(arg);
      return `✅ נוסף (#${want.id}): ${want.text}${store.group ? "" : "\n\n⚠️ עוד לא בחרת קבוצה. שלח: קבוצות"}`;
    }

    case "רשימה": {
      if (!store.wants.length) return "📭 אין חיפושים כרגע. הוסף עם: חפש <משהו>";
      const lines = store.wants.map((w) => `${w.id}. ${w.text}`);
      const status = store.paused ? "\n\n⏸️ ההתראות מושהות (המשך כדי לחדש)" : "";
      return `🔎 מה אני מחפש בשבילך:\n${lines.join("\n")}${status}`;
    }

    case "מחק":
    case "הסר": {
      if (arg === "הכל") {
        store.clear();
        return "🗑️ כל החיפושים נמחקו.";
      }
      const exampleMatch = arg.match(/^דוגמה\s+#?(\d+)$/);
      if (exampleMatch) {
        return store.removeFeedback(Number(exampleMatch[1])) ? "🗑️ הדוגמה נמחקה." : "❓ אין דוגמה כזו. בדוק ב: דוגמאות";
      }
      const id = parseInt(arg.replace("#", ""), 10);
      if (isNaN(id)) return "✏️ כתוב את מספר החיפוש מתוך: רשימה. למשל: מחק 2";
      const removed = store.remove(id);
      return removed ? `🗑️ נמחק: ${removed.text}` : `❓ אין חיפוש מספר ${id}. בדוק ב: רשימה`;
    }

    case "קבוצות":
      return ctx.listGroups();

    case "בחר": {
      const n = parseInt(arg, 10);
      if (isNaN(n)) return "✏️ כתוב את מספר הקבוצה מתוך: קבוצות. למשל: בחר 3";
      return ctx.selectGroup(n);
    }

    case "דוגמאות": {
      if (!store.feedback.length) return "עוד לא למדתי כלום. לחץ 👍/👎 על התראות, או: פספסת <מספר חיפוש> <מה היה>";
      const icon = { good: "👍", bad: "👎", missed: "🔍" };
      const lines = store.feedback.map(
        (f) => `${f.id}. ${icon[f.verdict]} #${f.wantId} "${f.summary || f.text}"${f.note ? ` — ${f.note}` : ""}`,
      );
      return `🧠 מה למדתי (מחיקה: מחק דוגמה <מספר>):\n${lines.join("\n")}`;
    }

    case "פספסת": {
      const m = arg.match(/^#?(\d+)\s+(.+)$/s);
      if (!m) return "✏️ למשל: פספסת 1 ספה פינתית אפורה בחולון";
      const wantId = Number(m[1]);
      if (!store.wants.some((w) => w.id === wantId)) return `❓ אין חיפוש מספר ${wantId}. בדוק ב: רשימה`;
      store.addFeedback({ wantId, verdict: "missed", summary: m[2].trim(), text: m[2].trim() });
      return "🔍 תודה, פעם הבאה אתפוס פריטים כאלה.";
    }

    case "השהה":
      store.setPaused(true);
      return "⏸️ ההתראות הושהו. שלח: המשך";

    case "המשך":
      store.setPaused(false);
      return "▶️ ההתראות חזרו לפעול.";

    case "סטטוס":
      return ctx.status ? ctx.status() : null;

    case "עזרה":
    case "help":
    case "start":
      return HELP;

    default:
      return null;
  }
}
