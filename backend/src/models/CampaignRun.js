import mongoose from 'mongoose';

const campaignRunSchema = new mongoose.Schema(
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
    runNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      enum: ['queued', 'analyzing', 'generating', 'evaluating', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    jobId: {
      type: String,
      index: true,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    error: {
      type: String,
    },
    metricsSummary: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
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

campaignRunSchema.index({ tenantId: 1, campaignId: 1, runNumber: 1 }, { unique: true });
campaignRunSchema.index({ status: 1, createdAt: -1 });

export const CampaignRun = mongoose.model('CampaignRun', campaignRunSchema, 'campaign_runs');

