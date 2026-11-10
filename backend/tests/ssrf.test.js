import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validateSafeUrl } from '../src/validators/ssrfValidator.js';

describe('SSRF & URL Security Invariants', () => {
  test('Allows legitimate public e-commerce URLs', () => {
    const urls = [
      'https://www.lifelongindiaonline.com/products/example',
      'https://amazon.com/dp/B08N5WRWNW',
      'https://store.google.com/product/pixel_9_pro',
      'http://ecommerce-shop.org/item/42',
    ];

    for (const url of urls) {
      const res = validateSafeUrl(url);
      assert.strictEqual(res.valid, true, `Should allow valid URL: ${url}`);
      assert.ok(res.sanitizedUrl);
    }
  });

  test('Blocks loopback and localhost targets', () => {
    const maliciousUrls = [
      'http://localhost:5000/api/secret',
      'http://127.0.0.1:6379/flushall',
      'http://127.0.0.2/admin',
      'http://0.0.0.0:8000',
      'http://app.localhost/keys',
    ];

    for (const url of maliciousUrls) {
      const res = validateSafeUrl(url);
      assert.strictEqual(res.valid, false, `Should block loopback: ${url}`);
      assert.ok(res.error.includes('private') || res.error.includes('restricted') || res.error.includes('port'));
    }
  });

  test('Blocks cloud metadata services (AWS/GCP/Azure link-local)', () => {
    const cloudMetadataUrls = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254/computeMetadata/v1/',
      'http://instance-data/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ];

    for (const url of cloudMetadataUrls) {
      const res = validateSafeUrl(url);
      assert.strictEqual(res.valid, false, `Should block cloud metadata: ${url}`);
    }
  });

  test('Blocks private IPv4 CIDR ranges (10.x, 192.168.x, 172.16.x)', () => {
    const privateIps = [
      'http://10.0.0.1/dashboard',
      'http://192.168.1.1/router',
      'http://172.18.0.5:80/db',
      'http://172.31.255.255/internal',
    ];

    for (const url of privateIps) {
      const res = validateSafeUrl(url);
      assert.strictEqual(res.valid, false, `Should block private IP: ${url}`);
    }
  });

  test('Blocks dangerous and non-http schemes', () => {
    const badSchemes = [
      'file:///etc/passwd',
      'ftp://ftp.example.com/file',
      'gopher://127.0.0.1:6379',
      'javascript:alert(1)',
      'data:text/html,<h1>pwned</h1>',
    ];

    for (const url of badSchemes) {
      const res = validateSafeUrl(url);
      assert.strictEqual(res.valid, false, `Should block scheme: ${url}`);
    }
  });

  test('Blocks non-standard internal ports', () => {
    const badPorts = [
      'http://example.com:6379/redis',
      'http://example.com:27017/mongodb',
      'http://example.com:9000/minio',
      'http://example.com:22/ssh',
    ];

    for (const url of badPorts) {
      const res = validateSafeUrl(url);
      assert.strictEqual(res.valid, false, `Should block port: ${url}`);
      assert.ok(res.error.includes('port'));
    }
  });
});

