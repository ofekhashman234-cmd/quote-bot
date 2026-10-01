// 🖼️ הורדת תמונות וסרטונים מווטסאפ: המקור נשלח אליך, גרסה מוקטנת נשלחת ל-Claude.
import sharp from "sharp";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // מגבלת שליחת קבצים של בוט טלגרם

/** מקטין תמונה ל-JPEG בצלע ארוכה של `size` פיקסלים (מהיר יותר וזול יותר לבדיקה). */
export async function resizeForAi(buffer, size = 1000) {
  const out = await sharp(buffer)
    .rotate()
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { mimetype: "image/jpeg", data: out.toString("base64") };
}

// ווטסאפ שומר בכל הודעת מדיה תמונה ממוזערת (base64) בשדה body של הנתונים הגולמיים.
function thumbnailOf(msg) {
  const raw = msg._data?.body;
  if (typeof raw !== "string" || raw.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(raw.slice(0, 100))) return null;
  return Buffer.from(raw, "base64");
}

/**
 * מחזיר פונקציה שמורידה את המדיה של ההודעה כשצריך.
 * @returns {() => Promise<null | {kind, degraded, forAi, getOriginal: () => Promise<{buffer, mimetype, filename, kind, degraded}>}>}
 */
export function createMediaLoader(msg, { aiImageSize = 1000 } = {}) {
  return async () => {
    const thumb = thumbnailOf(msg);
    const thumbFile = thumb && { buffer: thumb, mimetype: "image/jpeg", filename: "thumb.jpg", kind: "image", degraded: true };

    if (msg.type === "image") {
      try {
        const m = await msg.downloadMedia();
        if (m?.data) {
          const buffer = Buffer.from(m.data, "base64");
          const file = { buffer, mimetype: m.mimetype, filename: m.filename || "photo.jpg", kind: "image", degraded: false };
          return { kind: "image", degraded: false, forAi: await resizeForAi(buffer, aiImageSize), getOriginal: async () => file };
        }
      } catch {
        // התמונה כבר לא זמינה להורדה: ממשיכים עם התמונה הממוזערת.
      }
      if (!thumbFile) return null;
      return { kind: "image", degraded: true, forAi: await resizeForAi(thumb, aiImageSize), getOriginal: async () => thumbFile };
    }

    if (msg.type === "video") {
      // הבדיקה לפי התמונה הממוזערת בלבד (מהיר). את הסרטון עצמו מורידים רק אם יש התאמה.
      const forAi = thumb ? await resizeForAi(thumb, aiImageSize) : null;
      const getOriginal = async () => {
        const size = msg._data?.size || 0;
        if (size && size <= MAX_VIDEO_BYTES) {
          try {
            const m = await msg.downloadMedia();
            if (m?.data) {
              return { buffer: Buffer.from(m.data, "base64"), mimetype: m.mimetype, filename: m.filename || "video.mp4", kind: "video", degraded: false };
            }
          } catch {
            // נופלים לתמונה הממוזערת
          }
        }
        return thumbFile;
      };
      return { kind: "video", degraded: !thumb, forAi, getOriginal };
    }

    return null;
  };
}
