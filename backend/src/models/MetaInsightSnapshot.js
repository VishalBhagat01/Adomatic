import mongoose from 'mongoose';

const metaInsightSnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    syncKey: {
      type: String,
      required: true,
    },
    syncRunId: {
      type: String,
      index: true,
      default: '',
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
    metaCampaignId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    metaCampaignName: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdSetId: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdSetName: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    metaAdName: {
      type: String,
      trim: true,
      default: '',
    },
    adPilotCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
      index: true,
    },
    adPilotCreativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creative',
      default: null,
      index: true,
    },
    origin: {
      type: String,
      enum: ['adpilot_generated', 'uploaded_creative', 'external_meta'],
      default: 'external_meta',
      index: true,
    },
    dateStart: {
      type: String,
      required: true, // YYYY-MM-DD in Meta ad account timezone
      index: true,
    },
    dateStop: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
    timezoneName: {
      type: String,
      default: 'UTC',
      trim: true,
    },
    timezoneOffsetHoursUtc: {
      type: Number,
      default: 0,
    },
    attributionSetting: {
      type: String,
      default: '7d_click_1d_view',
    },
    attributionWindows: {
      type: [String],
      default: ['7d_click', '1d_view'],
    },
    useUnifiedAttributionSetting: {
      type: Boolean,
      default: true,
    },
    isProvisionalAttribution: {
      type: Boolean,
      default: false,
    },
    breakdownKey: {
      type: String,
      default: 'none',
      index: true,
    },
    publisherPlatform: {
      type: String,
      default: null,
    },
    platformPosition: {
      type: String,
      default: null,
    },
    age: {
      type: String,
      default: null,
    },
    gender: {
      type: String,
      default: null,
    },
    // Core collected & preserved Meta metrics (null = unavailable, never fabricated)
    impressions: { type: Number, default: null },
    reach: { type: Number, default: null },
    spend: { type: Number, default: null },
    cpm: { type: Number, default: null },
    allClicks: { type: Number, default: null },
    allClickCtr: { type: Number, default: null },
    allClickCpc: { type: Number, default: null },
    linkClicks: { type: Number, default: null },
    linkCtr: { type: Number, default: null },
    cpc: { type: Number, default: null }, // Cost per inline link click
    landingPageViews: { type: Number, default: null },
    addToCart: { type: Number, default: null },
    purchases: { type: Number, default: null },
    purchaseConversionValue: { type: Number, default: null },
    cpa: { type: Number, default: null },
    roas: { type: Number, default: null },
    missingMetrics: { type: [String], default: [] },
    derivedFields: { type: [String], default: [] },
    rawActions: { type: mongoose.Schema.Types.Mixed, default: [] },
    rawActionValues: { type: mongoose.Schema.Types.Mixed, default: [] },
    isTestFixture: {
      type: Boolean,
      default: false,
      index: true,
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
        return ret;
      },
    },
  }
);

metaInsightSnapshotSchema.index({ tenantId: 1, syncKey: 1 }, { unique: true });
metaInsightSnapshotSchema.index({ tenantId: 1, metaAdAccountId: 1, dateStart: 1, breakdownKey: 1 });

export const MetaInsightSnapshot = mongoose.model(
  'MetaInsightSnapshot',
  metaInsightSnapshotSchema,
  'meta_insight_snapshots'
);

