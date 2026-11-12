import mongoose from 'mongoose';

const adCopySchema = new mongoose.Schema(
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
    creativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creative',
      index: true,
    },
    primaryText: {
      type: String,
      required: [true, 'Primary text is required'],
      trim: true,
    },
    primaryTexts: {
      type: [String],
      default: [],
    },
    headline: {
      type: String,
      required: [true, 'Headline is required'],
      trim: true,
    },
    headlines: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      trim: true,
    },
    descriptions: {
      type: [String],
      default: [],
    },
    callToAction: {
      type: String,
      trim: true,
    },
    platform: {
      type: String,
      trim: true,
    },
    placement: {
      type: String,
      trim: true,
    },
    creativeAngle: {
      type: String,
      trim: true,
    },
    audienceHypothesis: {
      type: String,
      trim: true,
    },
    supportingEvidence: {
      type: [String],
      default: [],
    },
    language: {
      type: String,
      default: 'en',
      trim: true,
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

adCopySchema.index({ tenantId: 1, campaignId: 1 });

export const AdCopy = mongoose.model('AdCopy', adCopySchema, 'ad_copies');

