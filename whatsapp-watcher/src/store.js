// 💾 שמירת רשימת החיפושים בקובץ JSON, כדי שלא תימחק כשהבוט מופעל מחדש.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_FILE = path.resolve("data/state.json");

export class Store {
  constructor(file = DEFAULT_FILE) {
    this.file = file;
    this.state = { wants: [], nextId: 1, paused: false };
    if (fs.existsSync(file)) {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  get wants() {
    return this.state.wants;
  }

  get paused() {
    return this.state.paused;
  }

  setPaused(paused) {
    this.state.paused = paused;
    this.save();
  }

  add(text) {
    const want = { id: this.state.nextId++, text: text.trim(), createdAt: new Date().toISOString() };
    this.state.wants.push(want);
    this.save();
    return want;
  }

  // מוחק לפי המספר שמופיע ב"!רשימה". מחזיר את מה שנמחק או null.
  remove(id) {
    const i = this.state.wants.findIndex((w) => w.id === id);
    if (i === -1) return null;
    const [removed] = this.state.wants.splice(i, 1);
    this.save();
    return removed;
  }

  clear() {
    this.state.wants = [];
    this.save();
  }
}
