// מפיק את gift/guide.html ל-PDF: node gift/render.cjs
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "guide.html"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: path.join(__dirname, "מדריך-הצעת-מחיר-שסוגרת.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true });
  await browser.close();
})();
