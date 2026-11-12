#!/usr/bin/env bash
set -euo pipefail

# AdPilot AI - MongoDB Restore Script
# Usage: CONFIRM_RESTORE=YES ./infrastructure/scripts/restore-mongodb.sh <path_to_archive.gz>

ARCHIVE_PATH="${1:-}"
CONTAINER_NAME="${MONGO_CONTAINER:-adpilot-prod-mongodb}"
MONGO_USER="${MONGO_INITDB_ROOT_USERNAME:-}"
MONGO_PASS="${MONGO_INITDB_ROOT_PASSWORD:-}"

if [[ -z "${ARCHIVE_PATH}" || ! -f "${ARCHIVE_PATH}" ]]; then
  echo "ERROR: Provide a valid .archive.gz path as the first argument." >&2
  exit 1
fi

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "ABORTED: Set CONFIRM_RESTORE=YES to authorize destructive database restore from ${ARCHIVE_PATH}." >&2
  exit 1
fi

if [[ -n "${MONGODB_URI:-}" ]] && command -v mongorestore >/dev/null 2>&1; then
  echo "Restoring ${ARCHIVE_PATH} via local mongorestore..."
  mongorestore --uri="${MONGODB_URI}" --archive="${ARCHIVE_PATH}" --gzip --drop
elif command -v docker >/dev/null 2>&1; then
  echo "Restoring ${ARCHIVE_PATH} into container ${CONTAINER_NAME}..."
  AUTH_ARGS=""
  if [[ -n "${MONGO_USER}" && -n "${MONGO_PASS}" ]]; then
    AUTH_ARGS="--username=${MONGO_USER} --password=${MONGO_PASS} --authenticationDatabase=admin"
  fi
  docker exec -i "${CONTAINER_NAME}" sh -c "mongorestore ${AUTH_ARGS} --archive --gzip --drop" < "${ARCHIVE_PATH}"
else
  echo "ERROR: Neither local mongorestore with MONGODB_URI nor docker daemon is available." >&2
  exit 1
fi

echo "MongoDB restore completed successfully from ${ARCHIVE_PATH}"

