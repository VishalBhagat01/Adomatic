import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema(
  {
    variantId: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    creativeId: { type: String, default: null },
    metaAdId: { type: String, default: null },
    hookType: { type: String, default: 'unknown' },
    marketingAngle: { type: String, default: 'general' },
    placement: { type: String, default: 'instagram_feed' },
    format: { type: String, enum: ['image', 'video', 'unknown'], default: 'image' },
    copyStructure: { type: String, default: 'standard' },
    spend: { type: Number, default: 0, min: 0 },
    impressions: { type: Number, default: 0, min: 0 },
    linkClicks: { type: Number, default: 0, min: 0 },
    conversions: { type: Number, default: 0, min: 0 },
    revenue: { type: Number, default: 0, min: 0 },
    ctr: { type: Number, default: null },
    conversionRate: { type: Number, default: null },
    cpa: { type: Number, default: null },
    roas: { type: Number, default: null },
  },
  { _id: false }
);

const creativeExperimentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    hypothesis: { type: String, required: true, trim: true },
    variableTested: {
      type: String,
      enum: [
        'hook_type',
        'marketing_angle',
        'placement',
        'format',
        'opening_scene',
        'product_visibility',
        'ad_copy',
        'multivariate',
      ],
      default: 'hook_type',
    },
    objective: { type: String, default: 'CONVERSIONS' },
    placement: { type: String, default: 'instagram_feed' },
    attributionSetting: { type: String, default: '7d_click_1d_view' },
    status: {
      type: String,
      enum: ['draft', 'running', 'concluded', 'inconclusive', 'archived'],
      default: 'running',
      index: true,
    },
    startDate: { type: Date, default: () => new Date() },
    endDate: { type: Date, default: null },
    minSampleImpressions: { type: Number, default: 1000, min: 100 },
    minSampleClicks: { type: Number, default: 30, min: 5 },
    variants: { type: [variantSchema], default: [] },
    confidenceLevel: { type: Number, min: 0, max: 1, default: 0 },
    pValue: { type: Number, min: 0, max: 1, default: 1 },
    winningVariantId: { type: String, default: null },
    conclusion: { type: String, default: '' },
    sampleSizeWarnings: { type: [String], default: [] },
    correlationVsCausationNote: { type: String, default: '' },
    banditEnabled: { type: Boolean, default: false },
    banditEligible: { type: Boolean, default: false },
    banditAllocations: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    requiresExplicitUserApproval: { type: Boolean, default: true },
    userApprovedBudgetAction: { type: Boolean, default: false },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
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

creativeExperimentSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const CreativeExperiment = mongoose.model(
  'CreativeExperiment',
  creativeExperimentSchema,
  'creative_experiments'
);

