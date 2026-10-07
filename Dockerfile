# Imagen para cualquier nube que acepte contenedores (Railway, Fly.io, un VPS…).
# Variables: DATABASE_URL (Postgres), AUTH_SECRET, GAME_SPEED, PORT.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
