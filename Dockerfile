# Imagen para Coolify (runwebx.com). Incluye Chromium (captura de agrometeorologia.cl) y
# LibreOffice (PDF idéntico al Word) con fuentes métricamente compatibles con Times New Roman.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El build no toca la base de datos: no se necesitan secretos aquí.
RUN npm run build

FROM node:24-bookworm-slim AS run
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium libreoffice-writer fonts-liberation fonts-dejavu-core fonts-crosextra-carlito \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHROME_PATH=/usr/bin/chromium \
    SOFFICE_PATH=/usr/bin/soffice
WORKDIR /app
RUN groupadd -r app && useradd -r -g app -m app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/plantillas ./plantillas
COPY --from=build --chown=app:app /app/supabase ./supabase
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
