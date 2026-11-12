import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { BadRequestError } from '../utils/errors.js';

export const STORAGE_BUCKETS = {
  CREATIVES: env.STORAGE_BUCKET_CREATIVES,
  ASSETS: env.STORAGE_BUCKET_ASSETS,
  TEMP: env.STORAGE_BUCKET_TEMP,
};

export const ALLOWED_CONTENT_TYPES = {
  // Images
  'image/jpeg': { ext: 'jpg', type: 'image' },
  'image/png': { ext: 'png', type: 'image' },
  'image/webp': { ext: 'webp', type: 'image' },
  'image/gif': { ext: 'gif', type: 'image' },
  'image/svg+xml': { ext: 'svg', type: 'image' },
  // Videos
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/webm': { ext: 'webm', type: 'video' },
  'video/quicktime': { ext: 'mov', type: 'video' },
};

export class StorageService {
  constructor() {
    this.client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    });
  }

  /**
   * Validate content-type for image or video assets.
   */
  validateContentType(contentType) {
    if (!ALLOWED_CONTENT_TYPES[contentType]) {
      throw new BadRequestError(
        `Unsupported media content-type: ${contentType}. Allowed types: ${Object.keys(ALLOWED_CONTENT_TYPES).join(', ')}`
      );
    }
    return ALLOWED_CONTENT_TYPES[contentType];
  }

  /**
   * Standardized object key generator following conventions:
   * tenants/{tenantId}/{entityType}/{entityId}/{timestamp}-{randomId}.{ext}
   */
  generateObjectKey({ tenantId, entityType, entityId, filename, contentType }) {
    if (!tenantId || !entityType || !entityId) {
      throw new BadRequestError('tenantId, entityType, and entityId are required to generate an object key');
    }

    const mediaInfo = this.validateContentType(contentType);
    const sanitizedFilename = (filename || 'asset')
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '-')
      .replace(/-+/g, '-');

    const timestamp = Date.now();
    const randomHex = Math.random().toString(36).substring(2, 8);

    return `tenants/${tenantId}/${entityType}/${entityId}/${timestamp}-${randomHex}-${sanitizedFilename}`;
  }

  /**
   * Generate presigned PUT URL for secure direct-to-S3 client uploads.
   * Eliminates the need to proxy binary payloads through Express and NEVER exposes credentials.
   */
  async getPresignedUploadUrl(bucket, key, contentType, expiresInSeconds = 900) {
    this.validateContentType(contentType);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      uploadUrl,
      bucket,
      key,
      contentType,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * Generate presigned GET URL for secure viewing of private media.
   */
  async getPresignedDownloadUrl(bucket, key, expiresInSeconds = 3600) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      downloadUrl,
      bucket,
      key,
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * Direct server-side upload buffer.
   */
  async uploadBuffer(bucket, key, buffer, contentType, metadata = {}) {
    this.validateContentType(contentType);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    });

    await this.client.send(command);
    logger.info(`Uploaded object to storage: ${bucket}/${key}`);
    return { bucket, key, sizeBytes: buffer.length, contentType };
  }

  /**
   * Direct server-side download to Buffer.
   */
  async downloadBuffer(bucket, key) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    const stream = response.Body;
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Check object existence and metadata.
   */
  async getObjectMetadata(bucket, key) {
    try {
      const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const res = await this.client.send(command);
      return {
        exists: true,
        contentLength: res.ContentLength,
        contentType: res.ContentType,
        lastModified: res.LastModified,
        metadata: res.Metadata,
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      throw err;
    }
  }

  /**
   * Delete object.
   */
  async deleteObject(bucket, key) {
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await this.client.send(command);
    logger.info(`Deleted object from storage: ${bucket}/${key}`);
  }

  /**
   * Ensure required private buckets exist on startup.
   */
  async ensureBucketsExist() {
    const buckets = Object.values(STORAGE_BUCKETS);
    const results = {};

    for (const bucket of buckets) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
        results[bucket] = 'exists';
      } catch (err) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
          try {
            await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
            logger.info(`Created private MinIO bucket: ${bucket}`);
            results[bucket] = 'created';
          } catch (createErr) {
            logger.error(`Failed to create bucket ${bucket}: ${createErr.message}`);
            results[bucket] = `error: ${createErr.message}`;
          }
        } else {
          results[bucket] = `error: ${err.message}`;
        }
      }
    }
    return results;
  }

  /**
   * Storage connectivity health check.
   */
  async getStorageHealth() {
    let timerId = null;
    try {
      const controller = new AbortController();
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          controller.abort();
          reject(new Error('Storage health check timed out'));
        }, 1200);
      });
      await Promise.race([
        this.client.send(
          new HeadBucketCommand({ Bucket: STORAGE_BUCKETS.CREATIVES }),
          { abortSignal: controller.signal }
        ),
        timeoutPromise,
      ]);
      return {
        status: 'ok',
        endpoint: env.STORAGE_ENDPOINT,
        buckets: STORAGE_BUCKETS,
      };
    } catch (error) {
      return {
        status: 'degraded',
        endpoint: env.STORAGE_ENDPOINT,
        error: error.message,
      };
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }
}

export const storageService = new StorageService();

