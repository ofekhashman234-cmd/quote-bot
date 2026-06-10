// 🌐 שרת האתר — מגיש את הטופס, מגן בסיסמה, ומפיק הצעת מחיר ב-PDF.
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { generateQuote } from "./src/quote.js";
import { renderQuotePdf } from "./src/pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ANTHROPIC_API_KEY, PORT } = process.env;
const APP_PASSWORD = process.env.APP_PASSWORD || "";

if (!ANTHROPIC_API_KEY) {
  console.error("❌ חסר ANTHROPIC_API_KEY בקובץ .env");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// --- בריאות (ל"מעיר" של Render) ---
app.get("/health", (_req, res) => res.send("ok"));

// --- התחברות בסיסמה (cookie פשוט) ---
// אם לא הוגדרה סיסמה, האתר פתוח (נוח לפיתוח מקומי).
function isAuthed(req) {
  if (!APP_PASSWORD) return true;
  const cookie = req.headers.cookie || "";
  return cookie.split(";").some((c) => c.trim() === `auth=${APP_PASSWORD}`);
}

app.post("/login", (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    // cookie שנשמר שנה, HttpOnly
    res.setHeader(
      "Set-Cookie",
      `auth=${APP_PASSWORD}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`
    );
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "סיסמה שגויה" });
});

// מסך התחברות פשוט
function loginPage() {
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>כניסה</title><link rel="stylesheet" href="/styles.css"></head>
<body class="login-body"><form class="login-card" onsubmit="return doLogin(event)">
<h1>🔒 כניסה</h1>
<input type="password" id="pw" placeholder="סיסמה" autocomplete="current-password" required>
<button type="submit">כניסה</button>
<div id="err" class="err"></div></form>
<script>
async function doLogin(e){e.preventDefault();
const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({password:document.getElementById('pw').value})});
if(r.ok){location.href='/';}else{document.getElementById('err').textContent='סיסמה שגויה';}
return false;}
</script></body></html>`;
}

// --- דף הבית (טופס) מאחורי הסיסמה ---
app.get("/", (req, res) => {
  if (!isAuthed(req)) return res.send(loginPage());
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// קבצים סטטיים (css). את index.html מגישים רק דרך "/" המוגן.
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// --- יצירת הצעת מחיר ---
app.post("/api/quote", async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "לא מורשה" });
  try {
    const lead = {
      clientName: req.body.clientName,
      projectType: req.body.projectType,
      requirements: req.body.requirements,
      budget: req.body.budget,
      deadline: req.body.deadline,
      notes: req.body.notes,
    };
    const quote = await generateQuote(lead);
    const pdf = await renderQuotePdf(quote);
    const fileName = `הצעת מחיר - ${quote.client_name || "לקוח"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.send(pdf);
  } catch (err) {
    console.error("שגיאה ביצירת הצעה:", err);
    res.status(500).json({ error: "קרתה תקלה ביצירת ההצעה. נסה שוב." });
  }
});

const port = PORT || 3000;
app.listen(port, () => console.log(`🌐 האתר רץ על http://localhost:${port}`));
