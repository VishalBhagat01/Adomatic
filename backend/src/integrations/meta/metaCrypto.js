import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

let warnedFallbackKey = false;

function resolveEncryptionKey() {
  const configured = (env.META_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!configured) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(
        'META_TOKEN_ENCRYPTION_KEY must be configured in production before storing Meta access tokens',
        500,
        'META_ENCRYPTION_KEY_MISSING'
      );
    }
    if (!warnedFallbackKey) {
      warnedFallbackKey = true;
      logger.warn(
        'META_TOKEN_ENCRYPTION_KEY is not set; using ephemeral development key derivation (configure a 32+ char key for production)'
      );
    }
    // Stable dev/test fallback derived cleanly without persisting plaintext tokens
    return crypto.createHash('sha256').update(`adpilot-dev-meta-key:${env.MONGODB_URI}`).digest();
  }

  // Support 64-char hex 256-bit keys directly or derive via SHA-256 from passphrase
  if (/^[0-9a-fA-F]{64}$/.test(configured)) {
    return Buffer.from(configured, 'hex');
  }
  return crypto.createHash('sha256').update(configured).digest();
}

/**
 * Encrypt a Meta OAuth or System User access token using AES-256-GCM.
 */
export function encryptToken(plaintextToken) {
  if (!plaintextToken || typeof plaintextToken !== 'string') {
    throw new AppError('Access token string is required for encryption', 400, 'INVALID_META_TOKEN');
  }
  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextToken.trim(), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    alg: 'aes-256-gcm',
    keyVersion: 1,
  };
}

/**
 * Decrypt an encrypted Meta token envelope inside backend integration memory only.
 */
export function decryptToken(envelope) {
  if (!envelope || !envelope.iv || !envelope.authTag || !envelope.ciphertext) {
    throw new AppError('Encrypted Meta token envelope is malformed or missing', 500, 'META_DECRYPT_ERROR');
  }
  const key = resolveEncryptionKey();
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Compute Meta's required server-side HMAC-SHA256 appsecret_proof parameter.
 */
export function computeAppSecretProof(accessToken, appSecret = env.META_APP_SECRET) {
  if (!accessToken || !appSecret) return null;
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

/**
 * Return only non-sensitive trailing token characters for UI audit display.
 */
export function getTokenLast4(token) {
  if (!token || typeof token !== 'string') return '****';
  const clean = token.trim();
  return clean.length >= 4 ? clean.slice(-4) : '****';
}

