// 💾 כל המצב של הבוט בקובץ JSON אחד: חיפושים, הקבוצה הנבחרת, התראות, משוב והוצאות.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_FILE = path.resolve("data/state.json");
const ALERT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FEEDBACK_PER_WANT = 8;

const EMPTY = () => ({
  wants: [],
  nextId: 1,
  paused: false,
  group: null, // { id, name }
  alerts: [],
  nextAlertId: 1,
  feedback: [],
  nextFeedbackId: 1,
  lastSeenTs: 0,
  spend: { date: "", usd: 0, notified: false },
});

export class Store {
  constructor(file = DEFAULT_FILE) {
    this.file = file;
    this.state = EMPTY();
    if (fs.existsSync(file)) {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  // ── חיפושים ──
  get wants() {
    return this.state.wants;
  }

  add(text) {
    const want = { id: this.state.nextId++, text: text.trim(), createdAt: new Date().toISOString() };
    this.state.wants.push(want);
    this.save();
    return want;
  }

  remove(id) {
    const i = this.state.wants.findIndex((w) => w.id === id);
    if (i === -1) return null;
    const [removed] = this.state.wants.splice(i, 1);
    this.state.feedback = this.state.feedback.filter((f) => f.wantId !== id);
    this.save();
    return removed;
  }

  clear() {
    this.state.wants = [];
    this.state.feedback = [];
    this.save();
  }

  // ── מצב ──
  get paused() {
    return this.state.paused;
  }

  setPaused(paused) {
    this.state.paused = paused;
    this.save();
  }

  get group() {
    return this.state.group;
  }

  setGroup(group) {
    this.state.group = group;
    this.save();
  }

  get lastSeenTs() {
    return this.state.lastSeenTs;
  }

  setLastSeen(ts) {
    if (ts > this.state.lastSeenTs) {
      this.state.lastSeenTs = ts;
      this.save();
    }
  }

  // ── התראות ──
  reserveAlertId() {
    const id = this.state.nextAlertId++;
    this.save();
    return id;
  }

  addAlert(alert) {
    const cutoff = Date.now() - ALERT_TTL_MS;
    this.state.alerts = this.state.alerts.filter((a) => a.ts > cutoff);
    this.state.alerts.push(alert);
    this.save();
    return alert;
  }

  getAlert(id) {
    return this.state.alerts.find((a) => a.id === id) || null;
  }

  updateAlert(id, patch) {
    const alert = this.getAlert(id);
    if (alert) {
      Object.assign(alert, patch);
      this.save();
    }
    return alert;
  }

  // התראות פתוחות (לא נמסרו) של מפרסם מסוים, מהחדשה לישנה.
  recentAlertsFrom(senderId, sinceTs) {
    return this.state.alerts
      .filter((a) => a.senderId === senderId && a.ts >= sinceTs && !a.gone)
      .sort((a, b) => b.ts - a.ts);
  }

  findAlertByStanza(stanzaId) {
    return this.state.alerts.find((a) => a.stanzaIds?.includes(stanzaId)) || null;
  }

  // ── משוב ולמידה ──
  addFeedback({ wantId, verdict, summary, text, note = "", imagePath = null }) {
    const fb = {
      id: this.state.nextFeedbackId++,
      wantId,
      verdict, // "good" | "bad" | "missed"
      summary,
      text,
      note,
      imagePath,
      ts: Date.now(),
    };
    this.state.feedback.push(fb);
    // שומרים רק את האחרונות לכל חיפוש, כדי שהפרומפט יישאר קצר.
    const forWant = this.state.feedback.filter((f) => f.wantId === wantId);
    if (forWant.length > MAX_FEEDBACK_PER_WANT) {
      const drop = new Set(forWant.slice(0, forWant.length - MAX_FEEDBACK_PER_WANT).map((f) => f.id));
      this.state.feedback = this.state.feedback.filter((f) => !drop.has(f.id));
    }
    this.save();
    return fb;
  }

  setFeedbackNote(id, note) {
    const fb = this.state.feedback.find((f) => f.id === id);
    if (fb) {
      fb.note = note;
      this.save();
    }
    return fb;
  }

  removeFeedback(id) {
    const before = this.state.feedback.length;
    this.state.feedback = this.state.feedback.filter((f) => f.id !== id);
    this.save();
    return this.state.feedback.length !== before;
  }

  get feedback() {
    return this.state.feedback;
  }

  // ── תקציב ──
  addSpend(usd, today = new Date().toISOString().slice(0, 10)) {
    if (this.state.spend.date !== today) this.state.spend = { date: today, usd: 0, notified: false };
    this.state.spend.usd += usd;
    this.save();
  }

  spentToday(today = new Date().toISOString().slice(0, 10)) {
    return this.state.spend.date === today ? this.state.spend.usd : 0;
  }

  // מחזיר true רק בפעם הראשונה ביום, כדי לשלוח הודעת "הגעת לתקרה" פעם אחת.
  markBudgetNotified() {
    if (this.state.spend.notified) return false;
    this.state.spend.notified = true;
    this.save();
    return true;
  }
}
