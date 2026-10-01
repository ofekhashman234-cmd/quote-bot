import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";

export const GROUP = { id: "120363000000@g.us", name: "מסירות גוש דן" };

export function tempStore({ group = GROUP, wants = ["ספה עד 800 ש״ח באזור המרכז", "אופניים חשמליים"] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-watch-"));
  const store = new Store(path.join(dir, "state.json"));
  if (group) store.setGroup(group);
  for (const w of wants) store.add(w);
  return store;
}

let n = 0;
export function makePost(overrides = {}) {
  n++;
  return {
    id: `msg-${n}`,
    stanzaId: `STANZA${n}`,
    chatId: GROUP.id,
    isGroup: true,
    fromMe: false,
    isStatus: false,
    senderId: "972500000001@c.us",
    senderName: "דנה",
    ts: Date.now(),
    text: "",
    kind: "text",
    quotedStanzaId: null,
    loadMedia: async () => null,
    getSenderNumber: async () => "972500000001",
    late: false,
    ...overrides,
  };
}

// תמונה מדומה: "original" הוא המקור שנשלח לטלגרם, forAi הגרסה המוקטנת.
export function fakeMedia(label = "sofa") {
  const original = { buffer: Buffer.from(`ORIGINAL-${label}`), mimetype: "image/jpeg", filename: `${label}.jpg`, kind: "image", degraded: false };
  return { kind: "image", degraded: false, forAi: { mimetype: "image/jpeg", data: `SMALL-${label}` }, getOriginal: async () => original, original };
}

export function offer(id, confidence = "high", extra = {}) {
  return {
    post_type: "offer",
    item_summary: "ספה 3 מושבים",
    price: "חינם",
    location: "חולון",
    matches: [{ id, confidence, reason: "ספה בחולון" }],
    gone: { previous_index: -1, certain: false },
    ...extra,
  };
}

export function result(postType, extra = {}) {
  return { post_type: postType, item_summary: "", price: "", location: "", matches: [], gone: { previous_index: -1, certain: false }, ...extra };
}

/** notifier שרושם כל קריאה, במקום לשלוח לטלגרם. */
export function recordingNotifier() {
  const calls = [];
  let tg = 100;
  const rec = (type) => async (...args) => {
    calls.push({ type, args });
    return ++tg;
  };
  return { calls, alert: rec("alert"), followUp: rec("followUp"), extraMedia: rec("extraMedia"), gone: rec("gone"), info: rec("info") };
}

export const testConfig = {
  notifyMaybe: true,
  dryRun: false,
  dailyBudgetUsd: 2,
  minTextLength: 4,
  followUpMinutes: 3,
  repostMinutes: 60,
  goneWindowHours: 24,
};
