// ⚡ הצינור: מקבל הודעה מהקבוצה ומחליט אם להתריע, תוך שניות.
// לא תלוי בווטסאפ או בטלגרם עצמם (מקבל אותם מבחוץ), כדי שאפשר יהיה לבדוק אותו בלי רשת.
import { isGoneText, looksLikeRequest } from "./matcher.js";

const MINUTE = 60 * 1000;

/**
 * מתרגם את תשובת ה-AI להחלטה: 🎯 / 🤔 / כלום.
 * הכלל החשוב: פוסט של מישהו שמחפש פריט לא מתריע אף פעם.
 * @returns {{level: "match"|"maybe", items: {wantId: number, reason: string, level: string}[]} | null}
 */
export function decide(result, text, config) {
  if (result.post_type !== "offer") return null;
  const requestish = looksLikeRequest(text);
  const items = [];
  for (const m of result.matches || []) {
    let level = m.confidence === "high" ? "match" : m.confidence === "medium" ? "maybe" : null;
    if (!level) continue;
    // הגנה כפולה: אם הטקסט נשמע כמו בקשה, רק התאמה בטוחה עוברת, וגם היא כ-🤔.
    if (requestish) {
      if (level !== "match") continue;
      level = "maybe";
    }
    if (level === "maybe" && !config.notifyMaybe) continue;
    items.push({ wantId: m.id, reason: m.reason, level });
  }
  if (!items.length) return null;
  return { level: items.some((i) => i.level === "match") ? "match" : "maybe", items };
}

/** מריץ עד n משימות במקביל. */
export function createLimiter(n) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= n || !waiting.length) return;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      next();
    });
}

const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();

/**
 * @param {object} deps
 * @param {import("./store.js").Store} deps.store
 * @param {(post: object, wants: object[], feedback: object[]) => Promise<{result: object, costUsd: number}>} deps.classify
 * @param {object} deps.notifier  alert / followUp / extraMedia / gone / info
 * @param {object} deps.config
 * @param {(alertId: number, image: object) => string|null} [deps.saveImage]
 */
export function createPipeline({ store, classify, notifier, config, saveImage = () => null, now = Date.now }) {
  const seen = new Set();
  const senderChains = new Map();

  // ההחלטה הסופית רצה אחת-אחת לכל מפרסם, כדי שאלבום שנבדק במקביל ייצור התראה אחת ולא ארבע.
  function serialFor(key, fn) {
    const prev = senderChains.get(key) || Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => {});
    senderChains.set(key, tail);
    tail.then(() => senderChains.get(key) === tail && senderChains.delete(key));
    return run;
  }

  function inScope(post) {
    const group = store.group;
    return Boolean(group) && post.isGroup && post.chatId === group.id && !post.fromMe && !post.isStatus;
  }

  async function handleMessage(post) {
    // 1. רק הקבוצה שנבחרה. צ'אטים פרטיים וקבוצות אחרות לא נוגעים בכלום.
    if (!inScope(post)) return { action: "ignored", reason: "scope" };
    if (seen.has(post.id)) return { action: "ignored", reason: "duplicate" };
    seen.add(post.id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
    store.setLastSeen(post.ts);
    if (store.paused || !store.wants.length) return { action: "ignored", reason: "paused" };

    const text = normalize(post.text);

    // 2. "נמסר" בתגובה לפוסט שהתריע, מהמפרסם עצמו: ודאי, בלי AI.
    if (post.quotedStanzaId && isGoneText(text)) {
      const alert = store.findAlertByStanza(post.quotedStanzaId);
      if (alert && alert.senderId === post.senderId && !alert.gone) {
        store.updateAlert(alert.id, { gone: true });
        await notifier.gone(alert, { text, media: null });
        return { action: "gone", alertId: alert.id };
      }
      return { action: "ignored", reason: "gone-not-certain" };
    }

    // 3. טקסט מהמפרסם זמן קצר אחרי התראה: מעבירים מיד כהמשך, בלי AI.
    let followedUp = false;
    const recent = store.recentAlertsFrom(post.senderId, now() - config.followUpMinutes * MINUTE);
    if (post.kind === "text" && recent.length && text && !isGoneText(text)) {
      await notifier.followUp(recent[0], text);
      followedUp = true;
    }

    // 4. מה בכלל שווה בדיקה.
    if (post.kind === "other") return { action: "ignored", reason: "type" };
    if (post.kind === "text" && text.length < config.minTextLength) {
      return followedUp ? { action: "followup" } : { action: "ignored", reason: "short" };
    }
    if (store.spentToday() >= config.dailyBudgetUsd) {
      if (store.markBudgetNotified()) {
        await notifier.info(
          `⚠️ הגעתי לתקרה היומית ($${config.dailyBudgetUsd}). אני לא בודק פוסטים עד מחר.\nלהגדלה: dailyBudgetUsd ב-config.js`,
        );
      }
      return { action: "ignored", reason: "budget" };
    }

    let media = null;
    if (post.kind === "image" || post.kind === "video") {
      media = await post.loadMedia().catch(() => null);
      if (!media?.forAi && text.length < config.minTextLength) return { action: "ignored", reason: "no-media" };
    }

    // 5. בדיקת AI. אם המפרסם התריע לאחרונה, שולחים גם את הפריטים שלו (לזיהוי X / "נמסר").
    const previousAlerts = store.recentAlertsFrom(post.senderId, now() - config.goneWindowHours * 60 * MINUTE);
    const { result, costUsd } = await classify(
      { text, image: media?.forAi, previous: previousAlerts.map((a) => a.summary) },
      store.wants,
      store.feedback,
    );
    if (costUsd) store.addSpend(costUsd);

    return serialFor(post.senderId, () => route({ post, text, media, result, previousAlerts, followedUp }));
  }

  async function route({ post, text, media, result, previousAlerts, followedUp }) {
    // X על התמונה / "נמסר" על פריט קודם: רק כשה-AI בטוח ורק לפריט של אותו מפרסם.
    const gi = result.gone?.previous_index ?? -1;
    if (result.gone?.certain && gi >= 0 && gi < previousAlerts.length) {
      const alert = store.getAlert(previousAlerts[gi].id);
      if (alert && !alert.gone) {
        store.updateAlert(alert.id, { gone: true });
        await notifier.gone(alert, { text, media });
        return { action: "gone", alertId: alert.id };
      }
    }

    const decision = decide(result, text, config);
    if (!decision) {
      // הטקסט הגיע בזמן שההתראה על התמונה עוד נשלחה: עכשיו היא קיימת, אז מעבירים כהמשך.
      const justAlerted =
        !followedUp && post.kind === "text" && text && !isGoneText(text)
          ? store.recentAlertsFrom(post.senderId, now() - config.followUpMinutes * MINUTE)[0]
          : null;
      if (justAlerted) {
        await notifier.followUp(justAlerted, text);
        return { action: "followup" };
      }
      return { action: followedUp ? "followup" : "no-match", result };
    }
    const wantIds = decision.items.map((i) => i.wantId);
    const sharesWant = (a) => a.wantIds.some((id) => wantIds.includes(id));

    // עוד תמונה מאותו פוסט/אלבום: מצרפים להתראה הקיימת.
    const sameBurst = store
      .recentAlertsFrom(post.senderId, now() - config.followUpMinutes * MINUTE)
      .find(sharesWant);
    if (sameBurst) {
      if (media) await notifier.extraMedia(sameBurst, media);
      else if (!followedUp && text) await notifier.followUp(sameBurst, text);
      store.updateAlert(sameBurst.id, { stanzaIds: [...sameBurst.stanzaIds, post.stanzaId] });
      return { action: "merged", alertId: sameBurst.id };
    }

    // אותו פוסט שפורסם שוב: לא מתריעים פעמיים.
    const repost = store
      .recentAlertsFrom(post.senderId, now() - config.repostMinutes * MINUTE)
      .find((a) => sharesWant(a) && text && a.text === text);
    if (repost) return { action: "ignored", reason: "repost" };

    const id = store.reserveAlertId();
    const alert = {
      id,
      level: decision.level,
      senderId: post.senderId,
      senderName: post.senderName,
      wantIds,
      summary: result.item_summary || text.slice(0, 40) || "פריט מתמונה",
      text,
      stanzaIds: [post.stanzaId],
      imagePath: media?.forAi ? saveImage(id, media.forAi) : null,
      ts: now(),
      gone: false,
      feedback: null,
      tgMessageId: null,
    };
    alert.tgMessageId = await notifier.alert({ alert, decision, result, post, media });
    store.addAlert(alert);
    return { action: "alert", level: decision.level, alertId: id };
  }

  return { handleMessage };
}
