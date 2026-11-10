#!/bin/sh
set -e

echo "[minio-init] Waiting for MinIO service at ${MINIO_ENDPOINT:-http://minio:9000}..."
until curl -s "${MINIO_ENDPOINT:-http://minio:9000}/minio/health/live"; do
  sleep 1
done

echo "[minio-init] MinIO is live. Configuring client..."
mc alias set local "${MINIO_ENDPOINT:-http://minio:9000}" "${MINIO_ROOT_USER:-adpilot_minio_user}" "${MINIO_ROOT_PASSWORD:-adpilot_minio_secret_key}"

# Create required private buckets
for BUCKET in adpilot-creatives adpilot-assets adpilot-temp; do
  if ! mc ls "local/${BUCKET}" > /dev/null 2>&1; then
    echo "[minio-init] Creating bucket: ${BUCKET}"
    mc mb "local/${BUCKET}"
  else
    echo "[minio-init] Bucket already exists: ${BUCKET}"
  fi

  # Enforce strictly private access (no anonymous reads or writes)
  echo "[minio-init] Enforcing private policy on: ${BUCKET}"
  mc anonymous set none "local/${BUCKET}"
done

echo "[minio-init] Storage initialization completed successfully."
exit 0

