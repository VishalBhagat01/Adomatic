import mongoose from 'mongoose';

const creativeSchema = new mongoose.Schema(
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
    conceptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreativeConcept',
      required: false,
      index: true,
    },
    conceptKey: {
      type: String,
      trim: true,
      index: true,
    },
    creativeKey: {
      type: String,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: 'Generated Creative',
    },
    assetType: {
      type: String,
      enum: ['image', 'video'],
      required: true,
      index: true,
    },
    placement: {
      type: String,
      trim: true,
      default: 'instagram_feed',
    },
    aspectRatio: {
      type: String,
      trim: true,
      default: '1:1',
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    bucket: {
      type: String,
      default: 'adpilot-creatives',
    },
    presignedUrl: {
      type: String,
      trim: true,
    },
    format: {
      type: String,
      trim: true,
    },
    dimensions: {
      width: { type: Number },
      height: { type: Number },
    },
    fileSizeBytes: {
      type: Number,
      min: 0,
    },
    durationSeconds: {
      type: Number,
    },
    hasAudio: {
      type: Boolean,
      default: false,
    },
    marketingAngle: {
      type: String,
      trim: true,
    },
    audienceHypothesis: {
      type: String,
      trim: true,
    },
    hook: {
      type: String,
      trim: true,
    },
    mainMessage: {
      type: String,
      trim: true,
    },
    visualComposition: {
      type: String,
      trim: true,
    },
    backgroundDirection: {
      type: String,
      trim: true,
    },
    creativeInstructions: {
      type: String,
      trim: true,
    },
    promptUsed: {
      type: String,
      trim: true,
    },
    overlaySpec: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    blueprint: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    approved: {
      type: Boolean,
      default: false,
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_review'],
      default: 'pending',
    },
    evaluation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    versionHistory: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    generationCostUsd: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['generating', 'ready', 'approved', 'rejected', 'failed', 'archived'],
      default: 'generating',
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

creativeSchema.index({ tenantId: 1, campaignId: 1, status: 1 });

export const Creative = mongoose.model('Creative', creativeSchema, 'creatives');
