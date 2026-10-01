import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPipeline, createLimiter, decide } from "../src/pipeline.js";
import { tempStore, makePost, fakeMedia, offer, result, recordingNotifier, testConfig, GROUP } from "./helpers.js";

function setup({ classifyResult = offer(1), store = tempStore(), config = testConfig } = {}) {
  const notifier = recordingNotifier();
  const classifyCalls = [];
  const classify = async (post, wants, feedback) => {
    classifyCalls.push({ post, wants, feedback });
    const r = typeof classifyResult === "function" ? classifyResult(post) : classifyResult;
    return { result: structuredClone(r), costUsd: 0.001 };
  };
  const pipeline = createPipeline({ store, classify, notifier, config });
  return { pipeline, notifier, store, classifyCalls };
}

describe("רק הקבוצה שנבחרה", () => {
  test("צ'אט פרטי: לא נבדק בכלל", async () => {
    const { pipeline, notifier, classifyCalls } = setup();
    const r = await pipeline.handleMessage(makePost({ chatId: "972500000009@c.us", isGroup: false, text: "ספה למסירה" }));
    assert.equal(r.reason, "scope");
    assert.equal(classifyCalls.length, 0);
    assert.equal(notifier.calls.length, 0);
  });

  test("קבוצה אחרת: לא נבדקת", async () => {
    const { pipeline, classifyCalls } = setup();
    const r = await pipeline.handleMessage(makePost({ chatId: "999@g.us", text: "ספה למסירה" }));
    assert.equal(r.reason, "scope");
    assert.equal(classifyCalls.length, 0);
  });

  test("לפני שנבחרה קבוצה: כלום לא נבדק", async () => {
    const { pipeline, classifyCalls } = setup({ store: tempStore({ group: null }) });
    await pipeline.handleMessage(makePost({ text: "ספה למסירה" }));
    assert.equal(classifyCalls.length, 0);
  });

  test("הודעה שלי וסטטוס: לא נבדקים", async () => {
    const { pipeline, classifyCalls } = setup();
    await pipeline.handleMessage(makePost({ fromMe: true, text: "ספה למסירה" }));
    await pipeline.handleMessage(makePost({ isStatus: true, text: "ספה למסירה" }));
    assert.equal(classifyCalls.length, 0);
  });

  test("אותה הודעה פעמיים (השלמה אחרי ניתוק): נבדקת פעם אחת", async () => {
    const { pipeline, classifyCalls } = setup();
    const post = makePost({ text: "ספה למסירה" });
    await pipeline.handleMessage(post);
    await pipeline.handleMessage(post);
    assert.equal(classifyCalls.length, 1);
  });
});

describe("מי שמחפש לא מקבל התראה", () => {
  test("AI אומר request: אין התראה, גם אם הפריט זהה לחיפוש", async () => {
    const { pipeline, notifier } = setup({ classifyResult: result("request", { matches: [{ id: 1, confidence: "high", reason: "ספה" }] }) });
    const r = await pipeline.handleMessage(makePost({ text: "מישהו מוסר ספה? צריכה דחוף" }));
    assert.equal(r.action, "no-match");
    assert.equal(notifier.calls.length, 0);
  });

  test("AI טעה ואמר offer, אבל הטקסט הוא בקשה: high יורד ל-🤔", () => {
    const d = decide(offer(1, "high"), "מחפשת ספה כזו, מישהו?", testConfig);
    assert.equal(d.level, "maybe");
  });

  test("AI טעה ואמר offer בביטחון בינוני, והטקסט הוא בקשה: אין התראה", () => {
    assert.equal(decide(offer(1, "medium"), "יש למישהו ספה?", testConfig), null);
  });

  test("gone_update / other: אין התראה", () => {
    assert.equal(decide(result("gone_update"), "נמסר", testConfig), null);
    assert.equal(decide(result("other"), "תודה לכולם", testConfig), null);
  });
});

describe("רמות ביטחון", () => {
  test("high → 🎯, medium → 🤔, low → כלום", () => {
    assert.equal(decide(offer(1, "high"), "ספה למסירה", testConfig).level, "match");
    assert.equal(decide(offer(1, "medium"), "ספה למסירה", testConfig).level, "maybe");
    assert.equal(decide(offer(1, "low"), "ספה למסירה", testConfig), null);
  });

  test("notifyMaybe כבוי: 🤔 לא נשלח", () => {
    assert.equal(decide(offer(1, "medium"), "ספה", { ...testConfig, notifyMaybe: false }), null);
  });
});

describe("התראה עם התמונה", () => {
  test("תמונה: AI מקבל את המוקטנת, טלגרם מקבל את המקורית", async () => {
    const { pipeline, notifier, classifyCalls, store } = setup();
    const media = fakeMedia("sofa");
    const r = await pipeline.handleMessage(makePost({ kind: "image", text: "", loadMedia: async () => media }));
    assert.equal(r.action, "alert");
    assert.equal(classifyCalls[0].post.image.data, "SMALL-sofa");
    const sent = notifier.calls.find((c) => c.type === "alert").args[0];
    assert.equal((await sent.media.getOriginal()).buffer.toString(), "ORIGINAL-sofa");
    assert.equal(store.getAlert(r.alertId).tgMessageId, 101);
  });

  test("תמונה בלי טקסט נבדקת מיד (לא מחכים לטקסט)", async () => {
    const { pipeline, classifyCalls } = setup();
    await pipeline.handleMessage(makePost({ kind: "image", text: "", loadMedia: async () => fakeMedia() }));
    assert.equal(classifyCalls.length, 1);
    assert.equal(classifyCalls[0].post.text, "");
  });

  test("פוסט טקסט בלבד נבדק ומתריע", async () => {
    const { pipeline } = setup();
    const r = await pipeline.handleMessage(makePost({ text: "ספה 3 מושבים למסירה בחולון" }));
    assert.equal(r.action, "alert");
  });
});

describe("אלבום, המשכים וכפילויות", () => {
  test("אלבום של 4 תמונות שנבדקות במקביל: התראה אחת + 3 תמונות כהמשך", async () => {
    const { pipeline, notifier } = setup();
    const posts = [1, 2, 3, 4].map((i) => makePost({ kind: "image", loadMedia: async () => fakeMedia(`p${i}`) }));
    const results = await Promise.all(posts.map((p) => pipeline.handleMessage(p)));
    assert.equal(results.filter((r) => r.action === "alert").length, 1);
    assert.equal(results.filter((r) => r.action === "merged").length, 3);
    assert.equal(notifier.calls.filter((c) => c.type === "extraMedia").length, 3);
  });

  test("טקסט מהמפרסם אחרי ההתראה: נשלח כהמשך, בלי AI", async () => {
    const { pipeline, notifier, classifyCalls } = setup({
      classifyResult: (post) => (post.image ? offer(2) : result("other")),
    });
    await pipeline.handleMessage(makePost({ kind: "image", loadMedia: async () => fakeMedia("bike") }));
    const r = await pipeline.handleMessage(makePost({ text: "350 ש״ח, ראשון לציון, סוללה חדשה" }));
    assert.equal(r.action, "followup");
    const fu = notifier.calls.find((c) => c.type === "followUp");
    assert.equal(fu.args[1], "350 ש״ח, ראשון לציון, סוללה חדשה");
    assert.equal(fu.args[0].tgMessageId, 101); // reply להתראה המקורית
    // הטקסט עדיין נבדק (אולי הוא פריט חדש), אבל לא נשלחה התראה נוספת
    assert.equal(notifier.calls.filter((c) => c.type === "alert").length, 1);
    assert.equal(classifyCalls.length, 2);
  });

  test("טקסט ממפרסם אחר: לא נשלח כהמשך", async () => {
    const { pipeline, notifier } = setup({ classifyResult: (post) => (post.image ? offer(1) : result("other")) });
    await pipeline.handleMessage(makePost({ kind: "image", loadMedia: async () => fakeMedia() }));
    await pipeline.handleMessage(makePost({ senderId: "972500000002@c.us", text: "מישהו יודע מתי האוטובוס?" }));
    assert.equal(notifier.calls.filter((c) => c.type === "followUp").length, 0);
  });

  test("אותו טקסט מאותו מפרסם אחרי 10 דקות: לא מתריעים שוב", async () => {
    let clock = Date.now();
    const store = tempStore();
    const notifier = recordingNotifier();
    const pipeline = createPipeline({
      store,
      notifier,
      config: testConfig,
      now: () => clock,
      classify: async () => ({ result: offer(1), costUsd: 0 }),
    });
    await pipeline.handleMessage(makePost({ text: "ספה למסירה בחולון", ts: clock }));
    clock += 10 * 60 * 1000;
    const r = await pipeline.handleMessage(makePost({ text: "ספה למסירה בחולון", ts: clock }));
    assert.equal(r.reason, "repost");
    assert.equal(notifier.calls.filter((c) => c.type === "alert").length, 1);
  });
});

describe("נמסר", () => {
  test("המפרסם מגיב 'נמסר' בציטוט לפוסט שהתריע: עדכון בלי AI", async () => {
    const { pipeline, notifier, classifyCalls } = setup();
    const original = makePost({ text: "ספה למסירה בחולון" });
    const first = await pipeline.handleMessage(original);
    const r = await pipeline.handleMessage(makePost({ text: "נמסר, תודה לכולם", quotedStanzaId: original.stanzaId }));
    assert.equal(r.action, "gone");
    assert.equal(r.alertId, first.alertId);
    assert.equal(classifyCalls.length, 1); // רק הפוסט המקורי נבדק
    assert.equal(notifier.calls.at(-1).type, "gone");
  });

  test("מישהו אחר מצטט וכותב 'נמסר?': אין עדכון", async () => {
    const { pipeline, notifier } = setup({ classifyResult: (post) => (post.text.includes("?") ? result("other") : offer(1)) });
    const original = makePost({ text: "ספה למסירה בחולון" });
    await pipeline.handleMessage(original);
    await pipeline.handleMessage(makePost({ senderId: "972500000002@c.us", text: "נמסר? אפשר לבוא היום?", quotedStanzaId: original.stanzaId }));
    await pipeline.handleMessage(makePost({ senderId: "972500000002@c.us", text: "נמסר", quotedStanzaId: original.stanzaId }));
    assert.equal(notifier.calls.filter((c) => c.type === "gone").length, 0);
  });

  test("X על התמונה מאותו מפרסם, AI בטוח: עדכון עם התמונה", async () => {
    const { pipeline, notifier, classifyCalls } = setup({
      classifyResult: (post) =>
        post.previous?.length ? result("gone_update", { gone: { previous_index: 0, certain: true } }) : offer(1),
    });
    await pipeline.handleMessage(makePost({ kind: "image", loadMedia: async () => fakeMedia("sofa") }));
    // אותה מפרסמת מעלה את התמונה שוב, עם X
    const xPost = makePost({ kind: "image", loadMedia: async () => fakeMedia("sofa-x") });
    const r = await pipeline.handleMessage(xPost);
    assert.equal(r.action, "gone");
    assert.deepEqual(classifyCalls[1].post.previous, ["ספה 3 מושבים"]);
    const gone = notifier.calls.find((c) => c.type === "gone");
    assert.equal((await gone.args[1].media.getOriginal()).buffer.toString(), "ORIGINAL-sofa-x");
  });

  test("X אבל AI לא בטוח: אין עדכון", async () => {
    const { pipeline, notifier } = setup({
      classifyResult: (post) =>
        post.previous?.length ? result("gone_update", { gone: { previous_index: 0, certain: false } }) : offer(1),
    });
    await pipeline.handleMessage(makePost({ kind: "image", loadMedia: async () => fakeMedia() }));
    await pipeline.handleMessage(makePost({ kind: "image", loadMedia: async () => fakeMedia() }));
    assert.equal(notifier.calls.filter((c) => c.type === "gone").length, 0);
  });
});

describe("למידה ותקציב", () => {
  test("משוב שנשמר נשלח ל-AI בבדיקה הבאה", async () => {
    const store = tempStore();
    store.addFeedback({ wantId: 1, verdict: "bad", summary: "כורסה", text: "כורסה למסירה", note: "רק ספות" });
    const { pipeline, classifyCalls } = setup({ store });
    await pipeline.handleMessage(makePost({ text: "ספה למסירה" }));
    assert.equal(classifyCalls[0].feedback[0].note, "רק ספות");
  });

  test("הגעה לתקרה היומית: עוצר ומודיע פעם אחת", async () => {
    const store = tempStore();
    store.addSpend(5);
    const { pipeline, notifier, classifyCalls } = setup({ store });
    await pipeline.handleMessage(makePost({ text: "ספה למסירה" }));
    await pipeline.handleMessage(makePost({ text: "עוד ספה למסירה" }));
    assert.equal(classifyCalls.length, 0);
    assert.equal(notifier.calls.filter((c) => c.type === "info").length, 1);
  });

  test("מושהה או בלי חיפושים: לא נבדק", async () => {
    const store = tempStore({ wants: [] });
    const { pipeline, classifyCalls } = setup({ store });
    await pipeline.handleMessage(makePost({ text: "ספה למסירה" }));
    assert.equal(classifyCalls.length, 0);
  });
});

test("createLimiter: לא יותר מ-n במקביל", async () => {
  const run = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = () =>
    run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
  await Promise.all([task(), task(), task(), task(), task()]);
  assert.equal(peak, 2);
});

test("GROUP helper sanity", () => assert.ok(GROUP.id.endsWith("@g.us")));
