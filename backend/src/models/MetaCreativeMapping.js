import mongoose from 'mongoose';

const metaCreativeMappingSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    adPilotCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
      index: true,
    },
    adPilotCreativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creative',
      default: null,
      index: true,
    },
    metaAdAccountId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    metaCampaignId: {
      type: String,
      trim: true,
      default: '',
    },
    metaCampaignName: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdSetId: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdSetName: {
      type: String,
      trim: true,
      default: '',
    },
    metaAdId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    metaAdName: {
      type: String,
      trim: true,
      default: '',
    },
    metaCreativeId: {
      type: String,
      trim: true,
      default: '',
    },
    origin: {
      type: String,
      enum: ['adpilot_generated', 'uploaded_creative', 'external_meta'],
      default: 'external_meta',
      index: true,
    },
    mappingSource: {
      type: String,
      enum: ['manual', 'utm_tag', 'publish_flow', 'auto_discovered'],
      default: 'manual',
    },
    creativeTitle: {
      type: String,
      trim: true,
      default: '',
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      default: null,
    },
    effectiveStatus: {
      type: String,
      trim: true,
      default: 'ACTIVE',
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    isTestFixture: {
      type: Boolean,
      default: false,
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

metaCreativeMappingSchema.index(
  { tenantId: 1, metaAdAccountId: 1, metaAdId: 1 },
  { unique: true }
);

export const MetaCreativeMapping = mongoose.model(
  'MetaCreativeMapping',
  metaCreativeMappingSchema,
  'meta_creative_mappings'
);

