import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { handleCommand } from "../src/commands.js";
import { keywordMatches, looksLikeRequest, isGoneText, buildSystemPrompt, costOf } from "../src/matcher.js";
import { tempStore } from "./helpers.js";

const ctx = { listGroups: async () => "groups", selectGroup: async (n) => `selected ${n}` };

describe("פקודות", () => {
  test("חיפוש, רשימה ומחיקה (עם או בלי ! /)", async () => {
    const store = tempStore({ wants: [] });
    assert.match(await handleCommand("חפש ספה תלת מושבית", store, ctx), /#1/);
    await handleCommand("!הוסף אופניים חשמליים", store, ctx);
    assert.match(await handleCommand("/רשימה", store, ctx), /ספה.*\n.*אופניים/s);
    assert.match(await handleCommand("מחק 1", store, ctx), /ספה/);
    assert.deepEqual(store.wants.map((w) => w.id), [2]);
    assert.match(await handleCommand("מחק 9", store, ctx), /אין חיפוש/);
  });

  test("טקסט שאינו פקודה מחזיר null", async () => {
    assert.equal(await handleCommand("סתם הודעה", tempStore(), ctx), null);
  });

  test("קבוצות ובחירת קבוצה עוברים ל-ctx", async () => {
    assert.equal(await handleCommand("בחר 3", tempStore(), ctx), "selected 3");
    assert.match(await handleCommand("בחר", tempStore(), ctx), /מספר הקבוצה/);
  });

  test("פספסת, דוגמאות ומחיקת דוגמה", async () => {
    const store = tempStore();
    assert.match(await handleCommand("פספסת 1 ספה פינתית אפורה", store, ctx), /אתפוס/);
    assert.match(await handleCommand("דוגמאות", store, ctx), /🔍 #1 "ספה פינתית אפורה"/);
    assert.match(await handleCommand("מחק דוגמה 1", store, ctx), /נמחקה/);
    assert.equal(store.feedback.length, 0);
    assert.match(await handleCommand("פספסת 9 משהו", store, ctx), /אין חיפוש/);
  });

  test("השהיה נשמרת בקובץ", async () => {
    const store = tempStore();
    await handleCommand("השהה", store, ctx);
    assert.equal(new Store(store.file).paused, true);
  });
});

describe("store", () => {
  test("משוב: נשמרות רק 8 הדוגמאות האחרונות לכל חיפוש", () => {
    const store = tempStore();
    for (let i = 0; i < 12; i++) store.addFeedback({ wantId: 1, verdict: "bad", summary: `x${i}`, text: "" });
    const forWant = store.feedback.filter((f) => f.wantId === 1);
    assert.equal(forWant.length, 8);
    assert.equal(forWant[0].summary, "x4");
  });

  test("מחיקת חיפוש מוחקת גם את הדוגמאות שלו", () => {
    const store = tempStore();
    store.addFeedback({ wantId: 1, verdict: "bad", summary: "x", text: "" });
    store.remove(1);
    assert.equal(store.feedback.length, 0);
  });

  test("הוצאה יומית מתאפסת ביום חדש", () => {
    const store = tempStore();
    store.addSpend(1.5, "2026-10-01");
    assert.equal(store.spentToday("2026-10-01"), 1.5);
    assert.equal(store.spentToday("2026-10-02"), 0);
  });
});

describe("זיהוי בקשות (הגנה נוספת)", () => {
  const requests = [
    "מחפשת עגלת תינוק במצב טוב",
    "יש למישהו מקרר שהוא לא צריך?",
    "למישהו יש מיקרוגל עובד?",
    "מישהו מוסר ספה? עוברת דירה",
    "דרוש: אופניים חשמליים לילד",
    "מעוניין לקנות אופניים חשמליים",
    "רלוונטי לי ספה תלת",
    "יש מצב שמישהו מוסר מקרר מקפיא?",
    "בקשה: מיקרוגל לסטודנטית",
    "אם למישהו יש עגלה מיותרת אשמח",
    "מישהו נתקל במקרר קטן למכירה?",
  ];
  const offers = [
    "ספה תלת מושבית למסירה, חולון",
    "ספה למסירה, מי רוצה?",
    "צריך לפנות עד מחר, הכל למסירה",
    "אשמח שמישהו ייקח את המקרר",
    "מוסרת עגלה, לאסוף עד מחר בבקשה",
    "מיקרוגל למסירה, מישהו?",
  ];
  for (const t of requests) test(`בקשה: ${t}`, () => assert.equal(looksLikeRequest(t), true));
  for (const t of offers) test(`הצעה: ${t}`, () => assert.equal(looksLikeRequest(t), false));
});

describe("זיהוי 'נמסר' ודאי", () => {
  for (const t of ["נמסר", "נמסר, תודה לכולם!", "נמכרה תודה", "כבר לא רלוונטי"]) {
    test(`נמסר: ${t}`, () => assert.equal(isGoneText(t), true));
  }
  for (const t of ["נמסר?", "נמסר לדנה, יש עוד אחד", "ספה למסירה", "נמסרות כל יום ספות"]) {
    test(`לא ודאי: ${t}`, () => assert.equal(isGoneText(t), false));
  }
});

describe("פרומפט ומחירים", () => {
  test("הפרומפט כולל את החיפושים ואת מה שנלמד", () => {
    const p = buildSystemPrompt(
      [{ id: 1, text: "ספה עד 800" }],
      [{ wantId: 1, verdict: "bad", summary: "כורסה", note: "רק ספות" }],
    );
    assert.match(p, /1\. ספה עד 800/);
    assert.match(p, /"כורסה" → המשתמש אמר: לא רלוונטי \(הערת המשתמש: רק ספות\)/);
  });

  test("עלות: Haiku זול מ-Opus", () => {
    const usage = { input_tokens: 1500, output_tokens: 150 };
    assert.ok(costOf("claude-haiku-4-5", usage) < costOf("claude-opus-5-5", usage));
    assert.equal(costOf("claude-opus-5-5", usage).toFixed(4), "0.0090");
  });

  test("מצב מילות מפתח: תחיליות עבריות, בלי מילות מילוי", () => {
    const wants = [{ id: 1, text: "ספה עד 800 ש״ח" }, { id: 2, text: "אופניים חשמליים" }];
    assert.deepEqual(keywordMatches("מוסרת הספה שלנו, מצב מעולה", wants).map((m) => m.id), [1]);
    assert.deepEqual(keywordMatches("למסירה שולחן עד יום חמישי 800", wants), []);
  });
});
