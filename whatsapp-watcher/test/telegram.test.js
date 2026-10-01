import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAlert, alertButtons, createController, createNotifier } from "../src/telegram.js";
import { tempStore, makePost, fakeMedia, offer } from "./helpers.js";

const alert = { id: 7, summary: "ספה 3 מושבים", text: "ספה למסירה בחולון", senderName: "דנה", wantIds: [1], tgMessageId: 55, imagePath: null };

test("טקסט ההתראה: כותרת, הטקסט, למה זה מתאים, קבוצה ומפרסם", () => {
  const caption = formatAlert({
    alert,
    decision: { level: "match", items: [{ wantId: 1, reason: "ספה בחולון", level: "match" }] },
    result: offer(1),
    post: makePost({ ts: Date.parse("2026-10-01T07:02:05Z") }),
    wants: [{ id: 1, text: "ספה עד 800 ש״ח" }],
    groupName: "מסירות גוש דן",
    dryRun: true,
  });
  assert.match(caption, /^\[ניסיון\] 🎯 ספה 3 מושבים · חינם · חולון/);
  assert.match(caption, /"ספה למסירה בחולון"/);
  assert.match(caption, /מתאים ל: #1 ספה עד 800 ש״ח \(ספה בחולון\)/);
  assert.match(caption, /👥 מסירות גוש דן · 👤 דנה · 🕒 10:02:05/);
});

test("🤔 ובאיחור", () => {
  const caption = formatAlert({
    alert,
    decision: { level: "maybe", items: [{ wantId: 1, reason: "כורסה", level: "maybe" }] },
    result: offer(1, "medium"),
    post: makePost({ late: true }),
    wants: [{ id: 1, text: "ספה" }],
    groupName: "g",
  });
  assert.match(caption, /^⏱️ באיחור · 🤔 אולי: /);
  assert.match(caption, /אולי מתאים ל: #1/);
});

test("כפתורים: צ'אט עם המפרסם רק כשיש מספר, ותמיד 👍/👎", () => {
  const withNumber = alertButtons(alert, "972500000001");
  assert.match(withNumber[0][0].url, /^https:\/\/wa\.me\/972500000001\?text=/);
  assert.equal(withNumber[1][1].callback_data, "fb:bad:7");
  assert.equal(alertButtons(alert, null).length, 1);
});

function fakeTg() {
  const sent = [];
  let id = 500;
  const rec = (type) => async (...args) => {
    sent.push({ type, args });
    return ++id;
  };
  return { sent, sendText: rec("text"), sendPhoto: rec("photo"), sendVideo: rec("video"), answerCallback: rec("answer") };
}

test("notifier: ההתראה נשלחת כתמונה מקורית עם כפתורים", async () => {
  const tg = fakeTg();
  const store = tempStore();
  const notifier = createNotifier({ tg, store, config: { dryRun: false } });
  await notifier.alert({
    alert,
    decision: { level: "match", items: [{ wantId: 1, reason: "r", level: "match" }] },
    result: offer(1),
    post: makePost(),
    media: fakeMedia("sofa"),
  });
  const [photo] = tg.sent;
  assert.equal(photo.type, "photo");
  assert.equal(photo.args[0].buffer.toString(), "ORIGINAL-sofa");
  assert.ok(photo.args[2].buttons.length === 2);
});

test("notifier: המשך נשלח כ-reply להתראה", async () => {
  const tg = fakeTg();
  const notifier = createNotifier({ tg, store: tempStore(), config: { dryRun: false } });
  await notifier.followUp(alert, "350 ש״ח");
  assert.equal(tg.sent[0].args[1].replyTo, 55);
});

test("👎 שומר משוב, שואל למה, והתשובה נשמרת כהערה", async () => {
  const tg = fakeTg();
  const store = tempStore();
  store.addAlert({ ...alert, ts: Date.now(), feedback: null });
  const controller = createController({ tg, store, ctx: {}, chatId: "42" });

  await controller.handleUpdate({ callback_query: { id: "cb1", data: "fb:bad:7", message: { chat: { id: 42 } } } });
  assert.equal(store.feedback[0].verdict, "bad");
  const prompt = tg.sent.find((s) => s.type === "text");
  assert.equal(prompt.args[1].forceReply, true);

  await controller.handleUpdate({ message: { chat: { id: 42 }, text: "רק ספות, לא כורסאות", reply_to_message: { message_id: 502 } } });
  assert.equal(store.feedback[0].note, "רק ספות, לא כורסאות");

  // לחיצה שנייה לא נרשמת פעמיים
  await controller.handleUpdate({ callback_query: { id: "cb2", data: "fb:good:7", message: { chat: { id: 42 } } } });
  assert.equal(store.feedback.length, 1);
});

test("הודעות ממישהו אחר בטלגרם: מתעלמים", async () => {
  const tg = fakeTg();
  const store = tempStore();
  const controller = createController({ tg, store, ctx: {}, chatId: "42" });
  await controller.handleUpdate({ message: { chat: { id: 999 }, text: "מחק הכל" } });
  assert.equal(tg.sent.length, 0);
  assert.equal(store.wants.length, 2);
});
