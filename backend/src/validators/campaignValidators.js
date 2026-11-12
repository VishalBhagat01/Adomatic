import { z } from 'zod';
import { validateSafeUrl } from './ssrfValidator.js';
import { CAMPAIGN_STATUS } from '../models/Campaign.js';

export const createCampaignSchema = z.object({
  body: z.object({
    product_url: z
      .string()
      .trim()
      .min(1, 'product_url is required')
      .superRefine((val, ctx) => {
        const check = validateSafeUrl(val);
        if (!check.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: check.error,
          });
        }
      }),
    user_prompt: z
      .string()
      .trim()
      .max(2000, 'user_prompt cannot exceed 2000 characters')
      .optional()
      .default('')
      .refine((val) => val === '' || val.length >= 10, {
        message: 'user_prompt must be at least 10 characters when provided',
      }),
    formats: z
      .array(z.enum(['image', 'video']))
      .nonempty('At least one format ("image" or "video") is required'),
    placements: z
      .array(z.string().trim().min(2))
      .nonempty('At least one placement is required'),
    preview_product_data: z.record(z.unknown()).optional(),
    reference_image_urls: z.array(z.string().trim().url()).max(10).optional(),
  }),
});

export const queryCampaignsSchema = z.object({
  query: z.object({
    page: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 1))
      .refine((val) => val >= 1, 'Page must be at least 1'),
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 10))
      .refine((val) => val >= 1 && val <= 100, 'Limit must be between 1 and 100'),
    status: z
      .enum(Object.values(CAMPAIGN_STATUS))
      .optional(),
    search: z.string().trim().optional(),
  }),
});

export const campaignIdParamSchema = z.object({
  params: z.object({
    id: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid campaign ID format (must be 24-character hexadecimal ObjectId)'),
  }),
});

export const previewProductSchema = z.object({
  body: z.object({
    product_url: z
      .string()
      .trim()
      .min(1, 'product_url is required')
      .superRefine((val, ctx) => {
        const check = validateSafeUrl(val);
        if (!check.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: check.error,
          });
        }
      }),
    force_js: z.boolean().optional().default(false),
  }),
});

export const queryCreativesSchema = z.object({
  query: z.object({
    page: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 1))
      .refine((val) => val >= 1, 'Page must be at least 1'),
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 50))
      .refine((val) => val >= 1 && val <= 100, 'Limit must be between 1 and 100'),
    assetType: z.enum(['image', 'video']).optional(),
    status: z.enum(['generating', 'ready', 'approved', 'rejected', 'failed', 'archived']).optional(),
    approved: z.enum(['true', 'false']).optional(),
    campaignId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    placement: z.string().trim().optional(),
  }),
});

export const creativeIdParamSchema = z.object({
  params: z.object({
    creativeId: z.string().trim().min(1, 'creativeId is required'),
  }),
});

const overlaySpecSchema = z
  .object({
    headline: z.string().trim().max(140).optional(),
    subheadline: z.string().trim().max(240).optional(),
    cta: z.string().trim().max(60).optional(),
    badge: z.string().trim().max(60).optional(),
  })
  .optional();

export const updateCreativeSchema = z.object({
  params: z.object({
    creativeId: z.string().trim().min(1, 'creativeId is required'),
  }),
  body: z.object({
    title: z.string().trim().min(1).max(160).optional(),
    headline: z.string().trim().max(200).optional(),
    headlines: z.array(z.string().trim().min(1).max(200)).max(5).optional(),
    primaryText: z.string().trim().max(2000).optional(),
    primaryTexts: z.array(z.string().trim().min(1).max(2000)).max(5).optional(),
    descriptions: z.array(z.string().trim().max(500)).max(5).optional(),
    callToAction: z.string().trim().max(80).optional(),
    overlaySpec: overlaySpecSchema,
    backgroundDirection: z.string().trim().max(1000).optional(),
    creativeInstructions: z.string().trim().max(2000).optional(),
    approvalStatus: z.enum(['pending', 'approved', 'rejected', 'needs_review']).optional(),
  }),
});

export const regenerateCreativeSchema = z.object({
  params: z.object({
    creativeId: z.string().trim().min(1, 'creativeId is required'),
  }),
  body: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      headline: z.string().trim().max(200).optional(),
      primaryText: z.string().trim().max(2000).optional(),
      callToAction: z.string().trim().max(80).optional(),
      overlaySpec: overlaySpecSchema,
      backgroundDirection: z.string().trim().max(1000).optional(),
      creativeInstructions: z.string().trim().max(2000).optional(),
      aspectRatio: z.enum(['1:1', '4:5', '9:16']).optional(),
    })
    .optional()
    .default({}),
});

