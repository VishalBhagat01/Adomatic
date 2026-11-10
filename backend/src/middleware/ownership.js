import mongoose from 'mongoose';

// Fallback development identifiers
const DEFAULT_TENANT_ID = 'tenant_default';
const DEFAULT_USER_ID = new mongoose.Types.ObjectId('673111111111111111111111');

export function attachOwnershipContext(req, res, next) {
  // Extract tenant context from headers or default to dev tenant
  const tenantId = req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;
  const rawUserId = req.headers['x-user-id'];

  let userId = DEFAULT_USER_ID;
  if (rawUserId && mongoose.Types.ObjectId.isValid(rawUserId)) {
    userId = new mongoose.Types.ObjectId(rawUserId);
  }

  req.tenantId = String(tenantId).trim();
  req.userId = userId;

  next();
}

