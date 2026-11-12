import mongoose from 'mongoose';

const metaSyncRunSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    metaConnectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MetaConnection',
      default: null,
    },
    metaAdAccountId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    dateRange: {
      since: { type: String, required: true },
      until: { type: String, required: true },
    },
    breakdowns: {
      type: [String],
      default: [],
    },
    attributionWindows: {
      type: [String],
      default: ['7d_click', '1d_view'],
    },
    status: {
      type: String,
      enum: ['running', 'completed', 'completed_with_warnings', 'failed'],
      default: 'running',
      index: true,
    },
    campaignsCount: { type: Number, default: 0 },
    adsCount: { type: Number, default: 0 },
    mappingsUpdated: { type: Number, default: 0 },
    recordsFetched: { type: Number, default: 0 },
    recordsUpserted: { type: Number, default: 0 },
    rateLimitPeakPct: { type: Number, default: 0 },
    discrepancyWarnings: { type: [String], default: [] },
    missingMetricsSummary: { type: [String], default: [] },
    isTestFixture: { type: Boolean, default: false },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

metaSyncRunSchema.index({ tenantId: 1, metaAdAccountId: 1, createdAt: -1 });

export const MetaSyncRun = mongoose.model('MetaSyncRun', metaSyncRunSchema, 'meta_sync_runs');

