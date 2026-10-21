// מפיק PDF מקובץ HTML בתיקייה: node gift/render.cjs [guide.html] [שם-הקובץ.pdf]
const path = require("path");
const { chromium } = require("playwright");

const src = process.argv[2] || "guide.html";
const out = process.argv[3] || "מדריך-הצעת-מחיר-שסוגרת.pdf";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, src), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: path.join(__dirname, out), format: "A4", printBackground: true, preferCSSPageSize: true });
  await browser.close();
})();
