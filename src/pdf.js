// 📄 לוקח את הצעת המחיר (JSON) + תבנית HTML, ומפיק PDF מעוצב בעברית.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { business } from "../config/business.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../templates/quote.html");

// פורמט מספר עם מטבע, למשל "₪4,500"
function money(amount, currency) {
  const n = Number(amount || 0).toLocaleString("he-IL");
  return `${currency}${n}`;
}

function buildLineItems(items, currency) {
  return items
    .map(
      (it) => `
      <tr>
        <td>${escapeHtml(it.description)}</td>
        <td class="num">${it.quantity}</td>
        <td class="price">${money(it.unit_price, currency)}</td>
        <td class="price">${money(it.total, currency)}</td>
      </tr>`
    )
    .join("");
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// מספר הצעה אוטומטי לפי תאריך, למשל "2026-0610-417"
function quoteNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const rand = Math.floor(100 + Math.random() * 900);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}${p(d.getDate())}-${rand}`;
}

function fillTemplate(template, quote) {
  const currency = quote.currency || business.currency;

  const logo = business.logoUrl
    ? `<img class="logo" src="${business.logoUrl}" alt="logo" />`
    : "";

  const contactPhone = business.phone ? `<div>${escapeHtml(business.phone)}</div>` : "";
  const contactEmail = business.email ? `<div>${escapeHtml(business.email)}</div>` : "";
  const contactWebsite = business.website ? `<div>${escapeHtml(business.website)}</div>` : "";

  const discountRow =
    Number(quote.discount) > 0
      ? `<div class="row discount"><span>הנחה</span><span>−${money(quote.discount, currency)}</span></div>`
      : "";

  // המחירים כוללים מע"מ — מחשבים כמה מתוך הסה"כ הוא מע"מ (18%), לתצוגה בלבד.
  const VAT_RATE = 0.18;
  const vatAmount = Math.round((Number(quote.total) || 0) * VAT_RATE / (1 + VAT_RATE));

  const notesBlock = quote.notes
    ? `<div class="block"><span class="label">הערות:</span> ${escapeHtml(quote.notes)}</div>`
    : "";

  const replacements = {
    BRAND_COLOR: business.brandColor,
    BUSINESS_NAME: escapeHtml(business.name),
    TAGLINE: escapeHtml(business.tagline),
    LOGO: logo,
    CONTACT_PHONE: contactPhone,
    CONTACT_EMAIL: contactEmail,
    CONTACT_WEBSITE: contactWebsite,
    CONTACT_PHONE_INLINE: escapeHtml(business.phone || ""),
    QUOTE_NUMBER: quoteNumber(),
    CLIENT_NAME: escapeHtml(quote.client_name),
    DATE: new Date().toLocaleDateString("he-IL"),
    INTRO: escapeHtml(quote.intro),
    LINE_ITEMS: buildLineItems(quote.line_items, currency),
    SUBTOTAL: money(quote.subtotal, currency),
    DISCOUNT_ROW: discountRow,
    TOTAL: money(quote.total, currency),
    VAT_AMOUNT: money(vatAmount, currency),
    TIMELINE: escapeHtml(quote.timeline),
    PAYMENT_TERMS: escapeHtml(quote.payment_terms),
    VALIDITY: quote.validity_days ?? business.defaultValidityDays,
    REVISIONS_NOTE: escapeHtml(business.revisionsNote || ""),
    NOTES_BLOCK: notesBlock,
    VAT_NOTE: escapeHtml(business.vatNote),
  };

  let html = template;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  return html;
}

/**
 * מקבל הצעת מחיר (JSON) ומחזיר Buffer של קובץ PDF.
 * @param {Object} quote
 * @returns {Promise<Buffer>}
 */
export async function renderQuotePdf(quote) {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const html = fillTemplate(template, quote);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // חשוב לשרתים עם מעט זיכרון (Render חינמי)
      "--disable-gpu",
    ],
  });
  try {
    const page = await browser.newPage();
    // domcontentloaded מהיר; ואז ממתינים לפונט עד 4 שניות בלבד כדי לא להיתקע על הרשת.
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch (_) {}
    });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
