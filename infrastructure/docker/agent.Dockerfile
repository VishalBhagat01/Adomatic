# ================================
# AdPilot Agent Dockerfile (FastAPI + Playwright + FFmpeg)
# ================================
FROM python:3.13-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# System dependencies for multimedia processing, FFmpeg video assembly, and healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install chromium

# Development stage
FROM base AS dev
COPY . ./agent/
EXPOSE 8000
CMD ["uvicorn", "agent.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Hardened Production Runtime Stage
FROM base AS prod
RUN groupadd --system adpilot && useradd --system --gid adpilot --create-home adpilot \
    && mkdir -p /tmp/adpilot-video /tmp/adpilot-assets \
    && chown -R adpilot:adpilot /tmp/adpilot-video /tmp/adpilot-assets

COPY . ./agent/
RUN chown -R adpilot:adpilot /app /ms-playwright
USER adpilot

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "agent.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "65"]
