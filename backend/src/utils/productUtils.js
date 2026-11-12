/**
 * Shared product data & reference image normalization helpers for Express -> Agent calls.
 */

/**
 * Extract deduplicated reference image URL strings from either string[] or
 * ProductImage object arrays ({ url, is_primary }), prioritizing primary images first.
 */
export function extractReferenceImageUrls(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }

  const ordered = [];
  const secondary = [];

  for (const item of images) {
    if (typeof item === 'string') {
      const cleaned = item.trim();
      if (cleaned) secondary.push(cleaned);
      continue;
    }

    if (item && typeof item === 'object' && typeof item.url === 'string') {
      const cleaned = item.url.trim();
      if (!cleaned) continue;
      if (item.is_primary) {
        ordered.push(cleaned);
      } else {
        secondary.push(cleaned);
      }
    }
  }

  return Array.from(new Set([...ordered, ...secondary]));
}

/**
 * Determine whether stored/cached ProductData is missing or degraded
 * (e.g., placeholder "Unnamed Product" or zero extractable reference images)
 * and therefore requires fresh extraction from productUrl.
 */
export function isDegradedProductData(productData, { requireImages = true } = {}) {
  if (!productData || typeof productData !== 'object') {
    return true;
  }

  const name = typeof productData.product_name === 'string' ? productData.product_name.trim() : '';
  if (!name || name.toLowerCase() === 'unnamed product') {
    return true;
  }

  if (requireImages && extractReferenceImageUrls(productData.images).length === 0) {
    return true;
  }

  return false;
}

