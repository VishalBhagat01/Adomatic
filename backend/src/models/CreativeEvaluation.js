import mongoose from 'mongoose';

const creativeEvaluationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    creativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creative',
      required: true,
      unique: true,
    },
    visualScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    complianceScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    predictedCtr: {
      type: Number,
      min: 0,
    },
    overallScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    critiqueNotes: {
      type: String,
      trim: true,
    },
    evaluatorVersion: {
      type: String,
      default: 'v1.0.0',
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

creativeEvaluationSchema.index({ tenantId: 1, creativeId: 1 }, { unique: true });

export const CreativeEvaluation = mongoose.model('CreativeEvaluation', creativeEvaluationSchema, 'creative_evaluations');
