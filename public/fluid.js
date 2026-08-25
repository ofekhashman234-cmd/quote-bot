// ============================================================
//  fluid.js — שכבת התנועה.
//  קפיץ אחד, שני פרמטרים (damping ratio + response), ניתן לקטיעה
//  בכל רגע: הוא תמיד ממשיך מהערך והמהירות שעל המסך עכשיו.
// ============================================================

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * קפיץ מונחה-התנהגות, לא אנימציה עם משך קבוע.
 *   damping  — יחס בלימה. 1.0 = בלי חריגה. 0.8 = קפיצה קלה.
 *   response — כמה מהר מגיעים ליעד (שניות). לא "duration".
 * מחזיר ידית עם setTarget() ששומרת על המהירות הנוכחית,
 * ולכן היפוך כיוון באמצע תנועה לא מייצר "קיר לבנים".
 */
export function spring({ from, to, velocity = 0, damping = 1, response = 0.4, onUpdate, onRest }) {
  let value = from;
  let v = velocity;
  let target = to;
  let raf = 0;
  let last = 0;
  let alive = true;

  // מיפוי הפרמטרים של Apple לפיזיקה (מסה = 1)
  let k = (2 * Math.PI / response) ** 2;
  let c = (4 * Math.PI * damping) / response;

  const settle = () => {
    value = target; v = 0; alive = false;
    onUpdate?.(value, 0);
    onRest?.(value);
  };

  if (REDUCED.matches) {
    // תנועה מופחתת: מגיעים ליעד מיד, המשוב עובר דרך שקיפות ב-CSS
    onUpdate?.(target, 0);
    queueMicrotask(() => onRest?.(target));
    return { setTarget: (t) => { target = t; onUpdate?.(t, 0); onRest?.(t); }, stop() {}, get value() { return target; }, get velocity() { return 0; } };
  }

  const tick = (now) => {
    if (!alive) return;
    let dt = Math.min((now - last) / 1000, 1 / 30);   // הגנה מפני קפיצת פריימים
    last = now;

    // אינטגרציה בצעדי משנה קבועים — יציב גם במהירויות גבוהות
    const step = 1 / 240;
    for (let t = 0; t < dt; t += step) {
      const h = Math.min(step, dt - t);
      const a = -k * (value - target) - c * v;
      v += a * h;
      value += v * h;
    }

    onUpdate?.(value, v);

    // מנוחה: גם קרוב ליעד וגם כמעט ללא מהירות
    if (Math.abs(value - target) < 0.4 && Math.abs(v) < 12) return settle();
    raf = requestAnimationFrame(tick);
  };

  last = performance.now();
  raf = requestAnimationFrame(tick);

  return {
    // מיקוד מחדש: הקפיץ ממשיך מהערך והמהירות הנוכחיים, בלי קפיצה
    setTarget(next, opts = {}) {
      target = next;
      if (opts.velocity !== undefined) v = opts.velocity;
      if (opts.damping !== undefined || opts.response !== undefined) {
        const d = opts.damping ?? damping;
        const r = opts.response ?? response;
        k = (2 * Math.PI / r) ** 2;
        c = (4 * Math.PI * d) / r;
      }
      if (!alive) { alive = true; last = performance.now(); raf = requestAnimationFrame(tick); }
    },
    stop() { alive = false; cancelAnimationFrame(raf); },
    get value() { return value; },
    get velocity() { return v; },
  };
}

/**
 * הטלת תנופה — לאן התנועה *הולכת*, לא איפה האצבע עזבה.
 * זו הנוסחה מקוד הדוגמה של Apple (דעיכה מעריכית), לא v²/2a.
 */
export function project(velocity, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/** גבול רך — ככל שמושכים רחוק יותר, האלמנט נגרר פחות. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** עוקב אחרי היסטוריית מיקום קצרה כדי לחשב מהירות אמיתית בשחרור. */
export class VelocityTracker {
  constructor(window = 100) { this.window = window; this.samples = []; }
  add(value) {
    const now = performance.now();
    this.samples.push({ value, t: now });
    while (this.samples.length > 2 && now - this.samples[0].t > this.window) this.samples.shift();
  }
  get() {
    if (this.samples.length < 2) return 0;
    const a = this.samples[0], b = this.samples[this.samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.value - a.value) / dt : 0;   // px/s
  }
  reset() { this.samples.length = 0; }
}

/** רטט קצר — רק ברגעים משמעותיים, ובאותו פריים של החזותי. */
export function haptic(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} }
}

// ============================================================
//  Sheet נגרר — 1:1 עם האצבע, ניתן לתפיסה באמצע תנועה.
// ============================================================
export function createSheet(sheetEl, scrimEl, { onDismiss } = {}) {
  let anim = null;
  let y = sheetEl.offsetHeight || window.innerHeight;   // 0 = פתוח, height = סגור
  let height = y;
  let dragging = false;
  let grabOffset = 0;
  let open = false;
  const tracker = new VelocityTracker();

  const render = (val) => {
    y = val;
    sheetEl.style.transform = `translate3d(0, ${val}px, 0)`;
    // ה-scrim מתעמעם ברציפות יחד עם הגרירה — לא רק בסוף
    scrimEl.style.opacity = String(Math.max(0, 1 - val / height));
  };

  // הערך שעל המסך ברגע זה — ממנו מתחילה כל תנועה חדשה
  const presentationValue = () => {
    const m = new DOMMatrixReadOnly(getComputedStyle(sheetEl).transform);
    return Number.isFinite(m.m42) ? m.m42 : y;
  };

  function animateTo(target, { velocity = 0, damping = 1, response = 0.4 } = {}) {
    const from = presentationValue();
    if (anim) { anim.setTarget(target, { velocity, damping, response }); return; }
    anim = spring({
      from, to: target, velocity, damping, response,
      onUpdate: render,
      onRest: (v) => {
        anim = null;
        if (v >= height - 1) {
          sheetEl.dataset.open = "false";
          scrimEl.dataset.open = "false";
          open = false;
          onDismiss?.();
        }
      },
    });
  }

  function show() {
    height = sheetEl.offsetHeight;
    if (!open) { render(height); }             // מתחילים מלמטה — נכנס מהכיוון שאליו ייצא
    sheetEl.dataset.open = "true";
    scrimEl.dataset.open = "true";
    open = true;
    // מגירה: קפיצה קלה, כי היא מגיעה עם תנופה
    animateTo(0, { damping: 0.8, response: 0.35 });
  }

  function hide(velocity = 0) {
    height = sheetEl.offsetHeight;
    animateTo(height, { velocity, damping: 1, response: 0.35 });
  }

  sheetEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, input, textarea, select")) return;
    sheetEl.setPointerCapture(e.pointerId);
    height = sheetEl.offsetHeight;

    // תופסים את הגיליון גם באמצע תנועה — מהערך שעל המסך, בלי קפיצה
    const current = presentationValue();
    anim?.stop();
    anim = null;
    render(current);

    dragging = true;
    grabOffset = e.clientY - current;          // מכבדים *איפה* נתפס
    tracker.reset();
    tracker.add(e.clientY);
  });

  sheetEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tracker.add(e.clientY);
    let next = e.clientY - grabOffset;
    // מעל הגבול העליון: התנגדות מתגברת במקום עצירה קשיחה
    if (next < 0) next = -rubberband(-next, height);
    render(next);
  });

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    const velocity = tracker.get();                       // px/s בשחרור
    const projected = presentationValue() + project(velocity);   // לאן זה *הולך*

    // סימן המהירות מכריע, לא רק המיקום
    if (projected > height * 0.4) hide(velocity);
    else animateTo(0, { velocity, damping: 0.8, response: 0.35 });
  };
  sheetEl.addEventListener("pointerup", release);
  sheetEl.addEventListener("pointercancel", release);

  scrimEl.addEventListener("pointerdown", () => hide(0));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) hide(0); });

  return { show, hide, get isOpen() { return open; } };
}
