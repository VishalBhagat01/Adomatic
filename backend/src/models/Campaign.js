import mongoose from 'mongoose';

export const CAMPAIGN_STATUS = {
  INITIALIZED: 'INITIALIZED',
  QUEUED: 'QUEUED',
  EXTRACTING_PRODUCT: 'EXTRACTING_PRODUCT',
  ANALYZING_PRODUCT: 'ANALYZING_PRODUCT',
  GENERATING_STRATEGY: 'GENERATING_STRATEGY',
  PLANNING_CREATIVES: 'PLANNING_CREATIVES',
  GENERATING_ASSETS: 'GENERATING_ASSETS',
  EVALUATING_CREATIVES: 'EVALUATING_CREATIVES',
  GENERATING_COPY: 'GENERATING_COPY',
  ASSEMBLING_CAMPAIGN: 'ASSEMBLING_CAMPAIGN',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

export const STAGE_PROGRESS = {
  [CAMPAIGN_STATUS.INITIALIZED]: 5,
  [CAMPAIGN_STATUS.QUEUED]: 10,
  [CAMPAIGN_STATUS.EXTRACTING_PRODUCT]: 20,
  [CAMPAIGN_STATUS.ANALYZING_PRODUCT]: 35,
  [CAMPAIGN_STATUS.GENERATING_STRATEGY]: 50,
  [CAMPAIGN_STATUS.PLANNING_CREATIVES]: 65,
  [CAMPAIGN_STATUS.GENERATING_ASSETS]: 75,
  [CAMPAIGN_STATUS.EVALUATING_CREATIVES]: 85,
  [CAMPAIGN_STATUS.GENERATING_COPY]: 90,
  [CAMPAIGN_STATUS.ASSEMBLING_CAMPAIGN]: 95,
  [CAMPAIGN_STATUS.COMPLETED]: 100,
  [CAMPAIGN_STATUS.FAILED]: 0,
};

const stageHistorySchema = new mongoose.Schema(
  {
    stage: { type: String, required: true },
    status: { type: String, enum: ['started', 'completed', 'failed'], default: 'started' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    error: { type: String },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const errorMetadataSchema = new mongoose.Schema(
  {
    errorCode: { type: String },
    errorMessage: { type: String },
    failedStage: { type: String },
    failedAt: { type: Date },
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, 'Tenant ID is required'],
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      index: true,
    },
    productUrl: {
      type: String,
      required: [true, 'Product URL is required'],
      trim: true,
    },
    userPrompt: {
      type: String,
      required: [
        function () {
          return this.userPrompt === undefined || this.userPrompt === null;
        },
        'User prompt is required',
      ],
      trim: true,
      maxlength: 2000,
    },
    productData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    productWarnings: {
      type: [String],
      default: [],
    },
    strategyData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    planData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    executionMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    formats: [
      {
        type: String,
        enum: ['image', 'video'],
        required: true,
      },
    ],
    placements: [
      {
        type: String,
        trim: true,
        required: true,
      },
    ],
    name: {
      type: String,
      trim: true,
      default: 'Untitled Campaign',
    },
    status: {
      type: String,
      enum: Object.values(CAMPAIGN_STATUS),
      default: CAMPAIGN_STATUS.INITIALIZED,
      index: true,
    },
    currentStage: {
      type: String,
      default: CAMPAIGN_STATUS.INITIALIZED,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 5,
    },
    stageHistory: [stageHistorySchema],
    errorMetadata: errorMetadataSchema,
    idempotencyKey: {
      type: String,
    },
    jobId: {
      type: String,
      sparse: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
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

campaignSchema.index({ tenantId: 1, isDeleted: 1, createdAt: -1 });
campaignSchema.index({ tenantId: 1, status: 1 });
campaignSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const Campaign = mongoose.model('Campaign', campaignSchema, 'campaigns');
