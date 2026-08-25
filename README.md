# 📄 אתר הצעות מחיר

כלי אישי ליצירת הצעות מחיר מעוצבות ב-PDF.
פותחים קישור בדפדפן → ממלאים טופס קצר → Claude מחבר הצעת מחיר לפי המחירון שלך → מקבלים PDF.
**בלי אפליקציה, בלי חשבון.** מוגן בסיסמה.

---

## 🚀 הפעלה מהירה (מקומית, לבדיקה)

### 1. השג מפתח Claude
- היכנס ל-[console.anthropic.com](https://console.anthropic.com) → API Keys → צור מפתח.
- (צריך לטעון קרדיט קטן חד-פעמי, ~5$, שמספיק להמון הצעות.)

### 2. הגדר את הקובץ `.env`
העתק את `.env.example` לקובץ בשם `.env` ומלא:
```
ANTHROPIC_API_KEY=המפתח-מ-Anthropic
APP_PASSWORD=בחר-סיסמה-משלך
```

### 3. התקן והפעל
```bash
npm install
npm start
```
פתח בדפדפן: http://localhost:3000 → הזן את הסיסמה → מלא טופס → קבל PDF. 🎉

---

## ☁️ העלאה לאוויר (חינם, זמין 24/7 גם כשהמחשב כבוי)

1. העלה את התיקייה ל-GitHub.
2. ב-[Render](https://render.com) → **New → Web Service** → חבר את ה-repo (הוא יקרא את `render.yaml`).
3. ב-Environment של השירות הזן: `ANTHROPIC_API_KEY` ו-`APP_PASSWORD`.
4. בסיום תקבל כתובת קבועה (למשל `https://quote-bot.onrender.com`) — זה הקישור שתפתח מהטלפון מכל מקום.

> שכבת החינם של Render "נרדמת" בחוסר פעילות — הכניסה הראשונה אחרי הפסקה תיקח ~30–60 שניות.
> כדי שיגיב מיד תמיד: צור ב-[cron-job.org](https://cron-job.org) (חינם) משימה ששולחת בקשה ל-`<הכתובת>/health` כל 14 דקות.

---

## ✏️ התאמה אישית
- **המחירים שלך:** ערוך את `config/pricing.js`
- **פרטי העסק / לוגו / צבע מותג:** ערוך את `config/business.js`
- **עיצוב ה-PDF:** ערוך את `templates/quote.html`
- **עיצוב הטופס:** ערוך את `public/index.html` + `public/styles.css`
- **תנועה ומחוות** (קפיצים, גרירת ה-sheet, הטלת תנופה): `public/fluid.js`
- **החלפת מודל AI** (לחיסכון): ב-`config/business.js` שנה `model` ל-`"claude-sonnet-4-6"`
