# ================================
# AdPilot Frontend Dockerfile (React + Vite + Nginx)
# ================================
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

# Development stage
FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# Static Vite bundle builder
FROM base AS builder
RUN npm ci
COPY . .
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
RUN npm run build

# Hardened Nginx runtime stage
FROM nginx:alpine AS prod
COPY --from=builder /app/dist /usr/share/nginx/html

# Configure SPA routing + SSE-friendly backend proxy without requiring external context paths
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    add_header X-Frame-Options "SAMEORIGIN" always;\n\
    add_header X-Content-Type-Options "nosniff" always;\n\
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;\n\
    location /api/ {\n\
        proxy_pass http://backend:5000;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header Connection "";\n\
        proxy_buffering off;\n\
        proxy_cache off;\n\
        proxy_read_timeout 300s;\n\
    }\n\
    location = /health {\n\
        proxy_pass http://backend:5000/health;\n\
    }\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
