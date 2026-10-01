import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { resizeForAi, createMediaLoader } from "../src/media.js";

const bigJpeg = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#7a8" } }).jpeg().toBuffer();

test("הקטנה ל-AI: צלע ארוכה 1000px, JPEG", async () => {
  const out = await resizeForAi(await bigJpeg(), 1000);
  const meta = await sharp(Buffer.from(out.data, "base64")).metadata();
  assert.equal(out.mimetype, "image/jpeg");
  assert.equal(meta.width, 1000);
  assert.equal(meta.height, 667);
});

test("תמונה: AI מקבל מוקטנת, טלגרם מקבל את המקור בדיוק", async () => {
  const original = await bigJpeg();
  const msg = { type: "image", _data: {}, downloadMedia: async () => ({ data: original.toString("base64"), mimetype: "image/jpeg" }) };
  const media = await createMediaLoader(msg)();
  assert.equal(media.degraded, false);
  assert.ok(Buffer.from(media.forAi.data, "base64").length < original.length);
  assert.ok((await media.getOriginal()).buffer.equals(original));
});

test("הורדה נכשלה: נופלים לתמונה הממוזערת ומסמנים אותה", async () => {
  const thumb = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000" } }).jpeg().toBuffer();
  const msg = { type: "image", _data: { body: thumb.toString("base64") }, downloadMedia: async () => { throw new Error("gone"); } };
  const media = await createMediaLoader(msg)();
  assert.equal(media.degraded, true);
  assert.equal((await media.getOriginal()).degraded, true);
});

test("סרטון: נבדק לפי ה-thumbnail, והסרטון יורד רק כשצריך", async () => {
  const thumb = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000" } }).jpeg().toBuffer();
  let downloads = 0;
  const msg = { type: "video", _data: { body: thumb.toString("base64"), size: 1000 }, downloadMedia: async () => (downloads++, { data: "AAAA", mimetype: "video/mp4" }) };
  const media = await createMediaLoader(msg)();
  assert.ok(media.forAi);
  assert.equal(downloads, 0);
  assert.equal((await media.getOriginal()).kind, "video");
  assert.equal(downloads, 1);
});
