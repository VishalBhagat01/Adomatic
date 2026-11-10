import mongoose from 'mongoose';

const creativeConceptSchema = new mongoose.Schema(
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
    strategyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MarketingStrategy',
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Concept title is required'],
      trim: true,
    },
    hook: {
      type: String,
      trim: true,
    },
    visualPrompt: {
      type: String,
      trim: true,
    },
    aspectRatio: {
      type: String,
      enum: ['1:1', '9:16', '16:9', '4:5'],
      default: '1:1',
    },
    targetPlatform: {
      type: String,
      enum: ['meta', 'tiktok', 'google', 'instagram'],
    },
    status: {
      type: String,
      enum: ['draft', 'approved', 'rejected'],
      default: 'draft',
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

creativeConceptSchema.index({ tenantId: 1, campaignId: 1, status: 1 });

export const CreativeConcept = mongoose.model('CreativeConcept', creativeConceptSchema, 'creative_concepts');

