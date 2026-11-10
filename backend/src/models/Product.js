import mongoose from 'mongoose';

const productImageSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true },
    url: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, 'Tenant ID is required'],
      index: true,
      trim: true,
    },
    sku: {
      type: String,
      trim: true,
      sparse: true,
    },
    title: {
      type: String,
      required: [true, 'Product title is required'],
      trim: true,
      minlength: 1,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      index: true,
    },
    price: {
      type: Number,
      min: [0, 'Price must be non-negative'],
    },
    currency: {
      type: String,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: 'USD',
    },
    url: {
      type: String,
      trim: true,
    },
    images: [productImageSchema],
    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'active',
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

productSchema.index({ tenantId: 1, sku: 1 }, { unique: true, sparse: true });
productSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const Product = mongoose.model('Product', productSchema, 'products');

