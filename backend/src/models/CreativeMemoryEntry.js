import mongoose from 'mongoose';

const creativeMemoryEntrySchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    sourceCampaignId: { type: String, default: null, index: true },
    sourceCreativeId: { type: String, default: null, index: true },
    sourceMetaAdId: { type: String, default: null },
    productCategory: { type: String, default: 'general', index: true },
    productName: { type: String, default: '', trim: true },
    placement: { type: String, default: 'instagram_feed', index: true },
    format: { type: String, enum: ['image', 'video', 'unknown'], default: 'image', index: true },
    marketingAngle: { type: String, default: 'general', index: true },
    audienceHypothesis: { type: String, default: '' },
    hookType: { type: String, default: 'direct_benefit', index: true },
    copyStructure: { type: String, default: 'problem_solution_cta' },
    cta: { type: String, default: 'Shop Now' },
    productVisibility: { type: String, default: 'hero_centered' },
    videoDuration: { type: Number, default: null },
    outcomeStatus: {
      type: String,
      enum: ['winning', 'underperforming', 'inconclusive', 'rejected_qa'],
      default: 'inconclusive',
      index: true,
    },
    metricsSummary: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    qaScore: { type: Number, default: null },
    keyLearnings: { type: [String], default: [] },
    summaryText: { type: String, default: '' },
    tokenVector: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // Guardrail flag ensuring historical performance never mutates factual product specs/claims
    neverOverrideVerifiedProduct: { type: Boolean, default: true },
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

creativeMemoryEntrySchema.index({
  tenantId: 1,
  productCategory: 1,
  placement: 1,
  format: 1,
  outcomeStatus: 1,
});

export const CreativeMemoryEntry = mongoose.model(
  'CreativeMemoryEntry',
  creativeMemoryEntrySchema,
  'creative_memory_entries'
);

