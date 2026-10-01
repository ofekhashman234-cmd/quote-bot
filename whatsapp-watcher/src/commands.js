// 💬 פקודות שאתה שולח לעצמך ("הודעה לעצמי" בווטסאפ). כל פקודה מתחילה ב-"!".
export const HELP = `🤖 *פקודות הבוט* (שלח לעצמך):

*!חפש* <מה אתה מחפש> — הוסף חיפוש
   למשל: !חפש ספה תלת מושבית עד 800 ש״ח באזור המרכז
*!רשימה* — מה אני מחפש כרגע
*!מחק* <מספר> — מחק חיפוש (או *!מחק הכל*)
*!קבוצות* — הקבוצות שאתה חבר בהן ואילו נסרקות
*!השהה* / *!המשך* — עצירה וחידוש של ההתראות
*!עזרה* — ההודעה הזו`;

/**
 * מפענח פקודה ומבצע אותה. מחזיר את התשובה לשלוח, או null אם זו לא פקודה.
 * @param {string} body
 * @param {import("./store.js").Store} store
 * @param {{ listGroups: () => Promise<string> }} ctx
 */
export async function handleCommand(body, store, ctx) {
  const text = (body || "").trim();
  if (!text.startsWith("!")) return null;
  const [rawCmd, ...rest] = text.slice(1).trim().split(/\s+/);
  const cmd = rawCmd || "";
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "חפש":
    case "הוסף": {
      if (!arg) return "✏️ כתוב מה לחפש, למשל: !חפש אופניים חשמליים";
      const want = store.add(arg);
      return `✅ נוסף (#${want.id}): ${want.text}\nאתריע לך כשמשהו כזה יעלה בקבוצות.`;
    }

    case "רשימה": {
      if (!store.wants.length) return "📭 אין חיפושים כרגע. הוסף עם !חפש <משהו>";
      const lines = store.wants.map((w) => `*${w.id}.* ${w.text}`);
      const status = store.paused ? "\n\n⏸️ ההתראות מושהות (!המשך כדי לחדש)" : "";
      return `🔎 *מה אני מחפש בשבילך:*\n${lines.join("\n")}${status}`;
    }

    case "מחק":
    case "הסר": {
      if (arg === "הכל") {
        store.clear();
        return "🗑️ כל החיפושים נמחקו.";
      }
      const id = parseInt(arg.replace("#", ""), 10);
      if (isNaN(id)) return "✏️ כתוב את מספר החיפוש מתוך !רשימה, למשל: !מחק 2";
      const removed = store.remove(id);
      return removed ? `🗑️ נמחק: ${removed.text}` : `❓ אין חיפוש מספר ${id}. בדוק ב-!רשימה`;
    }

    case "קבוצות":
      return ctx.listGroups();

    case "השהה":
      store.setPaused(true);
      return "⏸️ ההתראות הושהו. שלח !המשך כדי לחדש.";

    case "המשך":
      store.setPaused(false);
      return "▶️ ההתראות חזרו לפעול.";

    case "עזרה":
    case "help":
      return HELP;

    default:
      return `❓ לא הכרתי את הפקודה "${cmd}".\n\n${HELP}`;
  }
}
