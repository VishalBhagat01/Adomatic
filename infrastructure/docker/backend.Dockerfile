# ================================
# AdPilot Backend Dockerfile
# ================================
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache wget tini

# Install dependencies cleanly
COPY package*.json ./

# Development stage (hot-reload via volume mount)
FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "run", "dev"]

# Production build stage
FROM base AS prod-deps
RUN npm ci --omit=dev && npm cache clean --force

# Hardened Production Runtime Stage
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget tini

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Drop root privileges
RUN chown -R node:node /app
USER node

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
