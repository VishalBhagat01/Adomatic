import { URL } from 'node:url';

// Reserved/Private IPv4 CIDRs and addresses
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,                         // Loopback 127.0.0.0/8
  /^10\./,                          // Private 10.0.0.0/8
  /^192\.168\./,                    // Private 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private 172.16.0.0/12
  /^169\.254\./,                    // Link-local / Cloud metadata 169.254.0.0/16
  /^0\./,                           // Current network 0.0.0.0/8
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // Carrier-grade NAT
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'instance-data',
  'metadata.google.internal',
]);

/**
 * Validate that a URL is well-formed, uses http/https, and does not target
 * internal hosts, loopback addresses, or cloud metadata endpoints.
 */
export function validateSafeUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'Product URL must be a non-empty string' };
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    return { valid: false, error: 'Malformed URL structure' };
  }

  // Scheme restriction: only http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Invalid protocol: "${parsed.protocol}". Only http: and https: are allowed`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostname check
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return {
      valid: false,
      error: `Target hostname "${hostname}" is private or reserved`,
    };
  }

  // IPv4 private address check
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        valid: false,
        error: `Target IP "${hostname}" is within a restricted private network range`,
      };
    }
  }

  // Port restrictions: only standard web ports allowed
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return {
      valid: false,
      error: `Non-standard port "${parsed.port}" is not permitted for product scraping`,
    };
  }

  // Ensure hostname has a dot or is a valid external domain
  if (!hostname.includes('.')) {
    return {
      valid: false,
      error: `Hostname "${hostname}" must be a fully-qualified domain name`,
    };
  }

  return { valid: true, sanitizedUrl: parsed.toString() };
}

