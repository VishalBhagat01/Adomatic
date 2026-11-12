import mongoose from 'mongoose';

const optimizationInsightSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
      index: true,
    },
    creativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creative',
      default: null,
      index: true,
    },
    metaAdId: {
      type: String,
      default: null,
      index: true,
    },
    experimentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreativeExperiment',
      default: null,
    },
    insightType: {
      type: String,
      enum: [
        'creative_fatigue',
        'budget_allocation',
        'audience_refinement',
        'copy_variation',
        'test_different_hook',
        'expand_promising_concept',
        'change_opening_scene',
        'test_another_placement',
        'improve_product_visibility',
        'revise_ad_copy',
        'insufficient_data_warning',
      ],
      required: true,
      index: true,
    },
    recommendation: {
      type: String,
      required: true,
      trim: true,
    },
    observedEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    sampleSizeWarning: {
      type: String,
      default: null,
    },
    correlationVsCausationNote: {
      type: String,
      default: null,
    },
    confidenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.8,
    },
    impactLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    actionStatus: {
      type: String,
      enum: ['pending', 'applied', 'dismissed'],
      default: 'pending',
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

optimizationInsightSchema.index({ tenantId: 1, campaignId: 1, insightType: 1 });

export const OptimizationInsight = mongoose.model('OptimizationInsight', optimizationInsightSchema, 'optimization_insights');

