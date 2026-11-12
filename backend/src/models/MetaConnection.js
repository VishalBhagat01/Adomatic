import mongoose from 'mongoose';

const connectedAdAccountSchema = new mongoose.Schema(
  {
    adAccountId: { type: String, required: true, trim: true }, // act_123456789
    accountId: { type: String, required: true, trim: true }, // 123456789
    name: { type: String, trim: true, default: '' },
    currency: { type: String, trim: true, uppercase: true, default: 'USD' },
    timezoneName: { type: String, trim: true, default: 'UTC' },
    timezoneOffsetHoursUtc: { type: Number, default: 0 },
    accountStatus: { type: Number, default: 1 },
    businessName: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const encryptedTokenSchema = new mongoose.Schema(
  {
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    ciphertext: { type: String, required: true },
    alg: { type: String, default: 'aes-256-gcm' },
    keyVersion: { type: Number, default: 1 },
  },
  { _id: false }
);

const metaConnectionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    connectionType: {
      type: String,
      enum: ['oauth_user', 'system_user'],
      required: true,
      default: 'oauth_user',
    },
    tokenType: {
      type: String,
      enum: ['USER', 'SYSTEM_USER'],
      default: 'USER',
    },
    accessTier: {
      type: String,
      enum: ['development_or_limited', 'full_access', 'system_user'],
      default: 'development_or_limited',
    },
    metaUserId: {
      type: String,
      trim: true,
      default: '',
    },
    metaUserName: {
      type: String,
      trim: true,
      default: '',
    },
    encryptedToken: {
      type: encryptedTokenSchema,
      required: true,
      select: false,
    },
    tokenLast4: {
      type: String,
      trim: true,
      maxlength: 8,
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    dataAccessExpiresAt: {
      type: Date,
      default: null,
    },
    scopes: {
      type: [String],
      default: [],
    },
    writeAuthorized: {
      type: Boolean,
      default: false,
    },
    writeAuthorizedAt: {
      type: Date,
      default: null,
    },
    writeAuthorizedBy: {
      type: String,
      trim: true,
      default: null,
    },
    primaryAdAccountId: {
      type: String,
      trim: true,
      default: null,
    },
    connectedAdAccounts: {
      type: [connectedAdAccountSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'expiring_soon', 'expired', 'revoked'],
      default: 'active',
      index: true,
    },
    lastDebuggedAt: {
      type: Date,
      default: null,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    isTestConnection: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.encryptedToken;
        return ret;
      },
    },
  }
);

metaConnectionSchema.index({ tenantId: 1, status: 1 });

export const MetaConnection = mongoose.model('MetaConnection', metaConnectionSchema, 'meta_connections');

