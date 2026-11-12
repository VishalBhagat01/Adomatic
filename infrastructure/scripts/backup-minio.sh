#!/usr/bin/env bash
set -euo pipefail

# AdPilot AI - MinIO / S3 Object Storage Mirror Backup Script
# Usage: ./infrastructure/scripts/backup-minio.sh [output_dir]

BACKUP_DIR="${1:-./backups/minio}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="${BACKUP_DIR}/${TIMESTAMP}"
ENDPOINT="${STORAGE_ENDPOINT:-http://localhost:9000}"
ACCESS_KEY="${STORAGE_ACCESS_KEY:-adpilot_minio_user}"
SECRET_KEY="${STORAGE_SECRET_KEY:-adpilot_minio_secret_key}"

mkdir -p "${DEST_DIR}"

if command -v mc >/dev/null 2>&1; then
  mc alias set adpilot-backup "${ENDPOINT}" "${ACCESS_KEY}" "${SECRET_KEY}" >/dev/null
  for bucket in adpilot-creatives adpilot-assets; do
    mkdir -p "${DEST_DIR}/${bucket}"
    echo "Mirroring bucket ${bucket} -> ${DEST_DIR}/${bucket}"
    mc mirror --overwrite "adpilot-backup/${bucket}" "${DEST_DIR}/${bucket}"
  done
  mc alias rm adpilot-backup >/dev/null || true
elif command -v docker >/dev/null 2>&1; then
  echo "Using minio/mc ephemeral container to mirror buckets -> ${DEST_DIR}"
  docker run --rm \
    --network adpilot-production_adpilot-prod-net \
    -v "$(pwd)/${DEST_DIR}:/backup" \
    --entrypoint /bin/sh \
    minio/mc:latest -c "
      mc alias set src http://minio:9000 '${ACCESS_KEY}' '${SECRET_KEY}' &&
      mc mirror --overwrite src/adpilot-creatives /backup/adpilot-creatives &&
      mc mirror --overwrite src/adpilot-assets /backup/adpilot-assets
    "
else
  echo "ERROR: Install MinIO Client (mc) or Docker to run object storage backups." >&2
  exit 1
fi

echo "MinIO backup complete at ${DEST_DIR}"

