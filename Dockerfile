# 🛡️ פתרון "ברזל": ארגז (Docker) שכבר מכיל את כל ספריות המערכת של Chrome.
# התמונה הרשמית של Puppeteer (בגרסה שתואמת בדיוק לחבילה שלנו) פותרת את
# השגיאה "Could not find Chrome" אחת ולתמיד.
FROM ghcr.io/puppeteer/puppeteer:24.43.1

# רצים כ-root כדי שנוכל להתקין חבילות ולכתוב לתיקיות.
USER root
WORKDIR /app

# Chrome יותקן לכאן — אותו נתיב בדיוק גם בבנייה וגם בריצה.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# קודם מעתיקים רק את קבצי החבילות (ניצול מטמון בנייה).
COPY package*.json ./

# מתקינים את התלויות ואז את Chrome המתאים בדיוק לגרסת Puppeteer.
RUN npm install --omit=dev && npx puppeteer browsers install chrome

# מעתיקים את שאר הקוד.
COPY . .

ENV NODE_ENV=production

# מפעילים את השרת.
CMD ["node", "server.js"]
