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
    headline: {
      type: String,
      required: [true, 'Headline is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    callToAction: {
      type: String,
      trim: true,
    },
    platform: {
      type: String,
      enum: ['meta', 'google', 'tiktok', 'instagram'],
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

