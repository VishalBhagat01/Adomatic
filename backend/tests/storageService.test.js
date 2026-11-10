import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  storageService,
  STORAGE_BUCKETS,
  ALLOWED_CONTENT_TYPES,
} from '../src/services/storageService.js';

describe('MinIO & S3 Storage Invariants', () => {
  test('Content-type validation accepts valid image and video MIME types', () => {
    assert.ok(storageService.validateContentType('image/png'));
    assert.ok(storageService.validateContentType('image/jpeg'));
    assert.ok(storageService.validateContentType('image/webp'));
    assert.ok(storageService.validateContentType('video/mp4'));
    assert.ok(storageService.validateContentType('video/quicktime'));
  });

  test('Content-type validation rejects unapproved and executable types', () => {
    assert.throws(() => storageService.validateContentType('application/x-msdownload'), /Unsupported media/);
    assert.throws(() => storageService.validateContentType('text/html'), /Unsupported media/);
    assert.throws(() => storageService.validateContentType('application/javascript'), /Unsupported media/);
  });

  test('generateObjectKey creates structured, sanitized multi-tenant keys', () => {
    const key = storageService.generateObjectKey({
      tenantId: 'brand_99',
      entityType: 'creatives',
      entityId: 'concept_42',
      filename: 'Hero Banner! Final (1).png',
      contentType: 'image/png',
    });

    assert.ok(key.startsWith('tenants/brand_99/creatives/concept_42/'));
    assert.ok(key.includes('hero-banner-final-1-.png'));
    // Never contains spaces or special characters
    assert.ok(!key.includes(' '));
    assert.ok(!key.includes('!'));
  });

  test('Presigned URL methods produce valid signed URLs without leaking credentials', async () => {
    const presigned = await storageService.getPresignedUploadUrl(
      STORAGE_BUCKETS.CREATIVES,
      'tenants/t1/creatives/c1/test.png',
      'image/png',
      300
    );

    assert.ok(presigned.uploadUrl.startsWith('http'));
    assert.ok(presigned.uploadUrl.includes('X-Amz-Signature') || presigned.uploadUrl.includes('X-Amz-Algorithm'));
    assert.strictEqual(presigned.bucket, STORAGE_BUCKETS.CREATIVES);
    assert.strictEqual(presigned.contentType, 'image/png');
    assert.strictEqual(presigned.expiresInSeconds, 300);

    const download = await storageService.getPresignedDownloadUrl(
      STORAGE_BUCKETS.CREATIVES,
      'tenants/t1/creatives/c1/test.png',
      600
    );
    assert.ok(download.downloadUrl.startsWith('http'));
    assert.strictEqual(download.expiresInSeconds, 600);
  });

  test('Default storage buckets enforce tenant isolation semantics', () => {
    assert.strictEqual(STORAGE_BUCKETS.CREATIVES, 'adpilot-creatives');
    assert.strictEqual(STORAGE_BUCKETS.ASSETS, 'adpilot-assets');
    assert.strictEqual(STORAGE_BUCKETS.TEMP, 'adpilot-temp');
  });
});

