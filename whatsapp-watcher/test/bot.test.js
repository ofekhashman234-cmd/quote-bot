import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { handleCommand } from "../src/commands.js";
import { keywordMatches } from "../src/matcher.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-watch-"));
  return new Store(path.join(dir, "state.json"));
}
const ctx = { listGroups: async () => "groups" };

test("commands: add, list, remove", async () => {
  const store = tempStore();
  assert.match(await handleCommand("!חפש ספה תלת מושבית", store, ctx), /#1/);
  await handleCommand("!הוסף אופניים חשמליים", store, ctx);
  assert.match(await handleCommand("!רשימה", store, ctx), /ספה.*\n.*אופניים/s);
  assert.match(await handleCommand("!מחק 1", store, ctx), /ספה/);
  assert.deepEqual(store.wants.map((w) => w.id), [2]);
  assert.match(await handleCommand("!מחק 9", store, ctx), /אין חיפוש/);
});

test("commands: ignores non-commands and persists state", async () => {
  const store = tempStore();
  assert.equal(await handleCommand("סתם הערה לעצמי", store, ctx), null);
  await handleCommand("!חפש מקרר", store, ctx);
  await handleCommand("!השהה", store, ctx);
  const reloaded = new Store(store.file);
  assert.equal(reloaded.wants[0].text, "מקרר");
  assert.equal(reloaded.paused, true);
});

test("keyword fallback catches Hebrew prefixes, ignores filler words", () => {
  const wants = [
    { id: 1, text: "ספה עד 800 ש״ח" },
    { id: 2, text: "אופניים חשמליים" },
  ];
  assert.deepEqual(keywordMatches("מוסרת הספה שלנו, מצב מעולה", wants).map((m) => m.id), [1]);
  assert.deepEqual(keywordMatches("למסירה שולחן עד יום חמישי 800", wants), []);
});
