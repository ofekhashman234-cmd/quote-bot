// 🧪 השוואת מודלים על מקרי בדיקה אמיתיים: דיוק, התראות שווא על מבקשים, מהירות ועלות.
// הרצה: npm run eval                      (כל המודלים, כל המקרים)
//        npm run eval -- --models claude-haiku-4-5
//        npm run eval -- --from-feedback  (גם הדוגמאות שלימדת את הבוט ב-👍/👎)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../src/matcher.js";
import { decide, createLimiter } from "../src/pipeline.js";
import { resizeForAi } from "../src/media.js";
import { config } from "../config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const MODELS = (argValue("--models") || "claude-haiku-4-5,claude-opus-5-5").split(",");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ צריך ANTHROPIC_API_KEY בקובץ .env כדי להריץ את ההשוואה.");
  process.exit(1);
}

// ── טעינת המקרים ──
const suites = [];
for (const file of fs.readdirSync(path.join(here, "cases"))) {
  if (!file.endsWith(".json") || file.includes(".example.")) continue;
  const suite = JSON.parse(fs.readFileSync(path.join(here, "cases", file), "utf8"));
  suites.push({ name: file, ...suite });
}

if (args.includes("--from-feedback")) {
  const statePath = path.resolve("data/state.json");
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const cases = state.feedback.map((f) => ({
      id: `fb-${f.id}`,
      category: "feedback",
      expect: f.verdict === "bad" ? `not:${f.wantId}` : `match:${f.wantId}`,
      text: f.text || f.summary,
      imagePath: f.imagePath,
    }));
    suites.push({ name: "feedback", wants: state.wants, feedback: state.feedback, cases });
  }
}

const jobs = [];
for (const suite of suites) {
  for (const c of suite.cases) {
    const imageFile = c.imagePath || (c.image && path.join(here, "images", c.image));
    if (imageFile && !fs.existsSync(imageFile)) {
      console.warn(`⚠️  מדלג על ${c.id}: לא מצאתי את התמונה ${imageFile}`);
      continue;
    }
    jobs.push({ suite, c, imageFile });
  }
}
console.log(`🧪 ${jobs.length} מקרים × ${MODELS.length} מודלים\n`);

// ── הרצה ──
function judge(expect, decision) {
  const ids = decision ? decision.items.map((i) => i.wantId) : [];
  const [kind, raw] = expect.split(":");
  const id = Number(raw);
  if (kind === "none") return decision === null;
  if (kind === "none-or-maybe") return decision === null || decision.level === "maybe";
  if (kind === "not") return !ids.includes(id);
  if (kind === "match") return ids.includes(id);
  throw new Error(`expect לא מוכר: ${expect}`);
}

const limit = createLimiter(4);
const rows = [];
await Promise.all(
  MODELS.flatMap((model) =>
    jobs.map(({ suite, c, imageFile }) =>
      limit(async () => {
        const image = imageFile ? await resizeForAi(fs.readFileSync(imageFile), config.aiImageSize) : undefined;
        try {
          const { result, costUsd, ms } = await classify({ text: c.text, image }, suite.wants, suite.feedback || [], {
            model,
            effort: config.effort,
          });
          const decision = decide(result, c.text, config);
          rows.push({ model, id: c.id, category: c.category, expect: c.expect, ok: judge(c.expect, decision), decision, result, costUsd, ms });
        } catch (err) {
          rows.push({ model, id: c.id, category: c.category, expect: c.expect, ok: false, error: err.message, costUsd: 0, ms: 0 });
        }
        process.stdout.write(".");
      }),
    ),
  ),
);
console.log("\n");

// ── סיכום ──
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const summary = MODELS.map((model) => {
  const r = rows.filter((x) => x.model === model);
  const requests = r.filter((x) => x.category === "request");
  const expectAlert = r.filter((x) => x.expect.startsWith("match"));
  const expectNone = r.filter((x) => !x.expect.startsWith("match"));
  const ms = r.filter((x) => x.ms).map((x) => x.ms);
  return {
    "מודל": model,
    "נכון": pct(r.filter((x) => x.ok).length, r.length),
    "התראות על מבקשים (יעד 0)": requests.filter((x) => x.decision).length,
    "התראות שווא": expectNone.filter((x) => !x.ok).length,
    "פספוסים": expectAlert.filter((x) => !x.ok).length,
    "🤔 מתוך ההתאמות": pct(expectAlert.filter((x) => x.decision?.level === "maybe").length, expectAlert.length),
    "זמן חציוני": `${(percentile(ms, 50) / 1000).toFixed(1)}s`,
    "זמן p95": `${(percentile(ms, 95) / 1000).toFixed(1)}s`,
    "עלות לפוסט": `$${(r.reduce((s, x) => s + x.costUsd, 0) / (r.length || 1)).toFixed(4)}`,
    "שגיאות": r.filter((x) => x.error).length,
  };
});
console.table(summary);

const failures = rows.filter((x) => !x.ok);
if (failures.length) {
  console.log("\n❌ טעויות:");
  for (const f of failures) {
    const got = f.error ? `שגיאה: ${f.error}` : f.decision ? `${f.decision.level} ${f.decision.items.map((i) => `#${i.wantId}`).join(",")}` : `none (${f.result?.post_type})`;
    console.log(`  ${f.model} · ${f.id} [${f.category}] צפוי ${f.expect}, התקבל ${got}`);
  }
}

const best = summary
  .filter((s) => s["התראות על מבקשים (יעד 0)"] === 0 && s["שגיאות"] === 0)
  .sort((a, b) => parseFloat(a["זמן חציוני"]) - parseFloat(b["זמן חציוני"]))[0];
console.log(
  best
    ? `\n✅ המהיר ביותר שלא התריע על אף מבקש: ${best["מודל"]} (${best["זמן חציוני"]}, נכון ${best["נכון"]}). עדכן model ב-config.js.`
    : "\n⚠️ אף מודל לא עבר בלי התראות על מבקשים. כדאי לחזק את הפרומפט לפני הפעלה.",
);

fs.mkdirSync(path.join(here, "results"), { recursive: true });
const out = path.join(here, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
console.log(`📄 פירוט מלא: ${path.relative(process.cwd(), out)}`);
