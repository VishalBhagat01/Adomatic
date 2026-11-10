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
      required: true,
      index: true,
    },
    insightType: {
      type: String,
      enum: ['creative_fatigue', 'budget_allocation', 'audience_refinement', 'copy_variation'],
      required: true,
      index: true,
    },
    recommendation: {
      type: String,
      required: true,
      trim: true,
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

