import mongoose from 'mongoose';

const campaignPerformanceSchema = new mongoose.Schema(
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
    date: {
      type: Date,
      required: true,
    },
    impressions: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    clicks: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    conversions: {
      type: Number,
      min: 0,
      default: 0,
    },
    spend: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    ctr: {
      type: Number,
      min: 0,
      default: 0,
    },
    cpc: {
      type: Number,
      min: 0,
      default: 0,
    },
    roas: {
      type: Number,
      min: 0,
      default: 0,
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

campaignPerformanceSchema.index({ tenantId: 1, campaignId: 1, date: 1 }, { unique: true });

export const CampaignPerformance = mongoose.model('CampaignPerformance', campaignPerformanceSchema, 'campaign_performance');

