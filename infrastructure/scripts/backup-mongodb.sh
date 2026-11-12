#!/usr/bin/env bash
set -euo pipefail

# AdPilot AI - MongoDB Compressed Backup Script
# Usage: ./infrastructure/scripts/backup-mongodb.sh [output_dir]

BACKUP_DIR="${1:-./backups/mongodb}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET_ARCHIVE="${BACKUP_DIR}/adpilot-mongodb-${TIMESTAMP}.archive.gz"
CONTAINER_NAME="${MONGO_CONTAINER:-adpilot-prod-mongodb}"
MONGO_USER="${MONGO_INITDB_ROOT_USERNAME:-}"
MONGO_PASS="${MONGO_INITDB_ROOT_PASSWORD:-}"
MONGO_DB="${MONGO_INITDB_DATABASE:-adpilot}"

mkdir -p "${BACKUP_DIR}"

if [[ -n "${MONGODB_URI:-}" ]] && command -v mongodump >/dev/null 2>&1; then
  echo "Running mongodump using MONGODB_URI -> ${TARGET_ARCHIVE}"
  mongodump --uri="${MONGODB_URI}" --archive="${TARGET_ARCHIVE}" --gzip
elif command -v docker >/dev/null 2>&1; then
  echo "Running mongodump inside container ${CONTAINER_NAME} -> ${TARGET_ARCHIVE}"
  AUTH_ARGS=""
  if [[ -n "${MONGO_USER}" && -n "${MONGO_PASS}" ]]; then
    AUTH_ARGS="--username=${MONGO_USER} --password=${MONGO_PASS} --authenticationDatabase=admin"
  fi
  docker exec "${CONTAINER_NAME}" sh -c "mongodump ${AUTH_ARGS} --db=${MONGO_DB} --archive --gzip" > "${TARGET_ARCHIVE}"
else
  echo "ERROR: Neither local mongodump with MONGODB_URI nor docker daemon is available." >&2
  exit 1
fi

echo "Backup completed: ${TARGET_ARCHIVE} ($(du -h "${TARGET_ARCHIVE}" | cut -f1))"

