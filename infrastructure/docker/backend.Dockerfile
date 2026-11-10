# Backend Production & Development Dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "run", "dev"]

FROM base AS prod
RUN npm ci --only=production
COPY . .
USER node
EXPOSE 5000
CMD ["node", "src/server.js"]

