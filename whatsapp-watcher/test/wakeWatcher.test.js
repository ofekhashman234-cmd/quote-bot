import { test } from "node:test";
import assert from "node:assert/strict";
import { createWakeWatcher } from "../src/wakeWatcher.js";

function setup() {
  let clock = 1_000_000;
  const wakes = [];
  const w = createWakeWatcher({ onWake: (g) => wakes.push(g), now: () => clock, setIntervalFn: () => null });
  return { wakes, tickAfter: (ms) => ((clock += ms), w.tick()) };
}

test("שינה של 47 דקות: התעוררות אחת עם המשך הנכון", () => {
  const { wakes, tickAfter } = setup();
  tickAfter(15_000);
  tickAfter(47 * 60_000);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].ms, 47 * 60_000);
  assert.equal(wakes[0].to - wakes[0].from, 47 * 60_000);
});

test("עיכוב קטן (20 שניות): לא נחשב שינה", () => {
  const { wakes, tickAfter } = setup();
  tickAfter(20_000);
  tickAfter(15_000);
  assert.equal(wakes.length, 0);
});

test("שתי שינות: שתי התעוררויות", () => {
  const { wakes, tickAfter } = setup();
  tickAfter(5 * 60_000);
  tickAfter(15_000);
  tickAfter(10 * 60_000);
  assert.equal(wakes.length, 2);
});
