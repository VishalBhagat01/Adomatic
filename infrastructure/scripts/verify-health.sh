#!/usr/bin/env bash
set -euo pipefail

# AdPilot AI - Production Readiness & Liveness Smoke Check
BACKEND_URL="${BACKEND_URL:-http://localhost:5000}"
AGENT_URL="${AGENT_URL:-http://localhost:8000}"

echo "Checking Backend Liveness (${BACKEND_URL}/health/live)..."
curl -fsS "${BACKEND_URL}/health/live" | head -c 400
echo ""

echo "Checking Backend Readiness (${BACKEND_URL}/health/ready)..."
curl -fsS "${BACKEND_URL}/health/ready" | head -c 400
echo ""

echo "Checking Backend Prometheus Metrics (${BACKEND_URL}/metrics)..."
curl -fsS "${BACKEND_URL}/metrics" | head -n 12

echo "Checking Agent Health (${AGENT_URL}/health)..."
curl -fsS "${AGENT_URL}/health" | head -c 400
echo ""

echo "All health and observability endpoints responded cleanly."

