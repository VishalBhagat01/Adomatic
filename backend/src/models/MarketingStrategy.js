import mongoose from 'mongoose';

const marketingStrategySchema = new mongoose.Schema(
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
    version: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    targetPersona: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    keyMessaging: [{ type: String, trim: true }],
    valuePropositions: [{ type: String, trim: true }],
    toneOfVoice: { type: String, trim: true },
    competitorAngles: [{ type: String, trim: true }],
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

marketingStrategySchema.index({ tenantId: 1, campaignId: 1, version: 1 }, { unique: true });

export const MarketingStrategy = mongoose.model('MarketingStrategy', marketingStrategySchema, 'marketing_strategies');

