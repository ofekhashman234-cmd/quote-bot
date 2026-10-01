# 🐳 להרצה על שרת (בעתיד). אותו דפוס כמו אתר הצעות המחיר: ארגז שכבר מכיל את כל מה ש-Chrome צריך.
FROM ghcr.io/puppeteer/puppeteer:24.38.0

USER root
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer \
    NODE_ENV=production \
    TZ=Asia/Jerusalem

COPY package*.json ./
RUN npm ci --omit=dev && npx puppeteer browsers install chrome

COPY . .

CMD ["node", "src/index.js"]
