FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Постоянные данные (база, фото, ключ сессий) — на подключённом диске
ENV DATA_DIR=/data UPLOAD_DIR=/data/uploads PORT=10000
RUN mkdir -p /data/uploads
EXPOSE 10000
CMD ["node", "server/index.js"]
