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
      required: true,
      index: true,
    },
    assetType: {
      type: String,
      enum: ['image', 'video'],
      required: true,
      index: true,
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
    status: {
      type: String,
      enum: ['generating', 'ready', 'failed', 'archived'],
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
