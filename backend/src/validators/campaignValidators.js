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
      .min(10, 'user_prompt must be at least 10 characters')
      .max(2000, 'user_prompt cannot exceed 2000 characters'),
    formats: z
      .array(z.enum(['image', 'video']))
      .nonempty('At least one format ("image" or "video") is required'),
    placements: z
      .array(z.string().trim().min(2))
      .nonempty('At least one placement is required'),
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

