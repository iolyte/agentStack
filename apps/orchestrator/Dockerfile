FROM node:20-bookworm-slim AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ] && npm ci; then :; else npm install; fi

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 4200
ENV ORCHESTRATOR_PORT=4200
CMD ["node", "dist/index.js"]
