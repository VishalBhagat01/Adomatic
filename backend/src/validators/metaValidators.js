import { z } from 'zod';
import mongoose from 'mongoose';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const adAccountRegex = /^(act_)?\d{4,25}$/;

export const oauthStartSchema = z.object({
  query: z.object({
    include_write_scope: z
      .enum(['true', 'false'])
      .optional(),
  }),
});

export const connectTokenSchema = z.object({
  body: z.object({
    access_token: z
      .string()
      .trim()
      .min(10, 'Meta access_token must be at least 10 characters'),
    connection_type: z
      .enum(['oauth_user', 'system_user'])
      .optional()
      .default('system_user'),
    primary_ad_account_id: z
      .string()
      .trim()
      .regex(adAccountRegex, 'Invalid Meta Ad Account ID format (expected numeric or act_...)')
      .optional(),
  }),
});

export const selectAdAccountSchema = z.object({
  body: z.object({
    ad_account_id: z
      .string()
      .trim()
      .regex(adAccountRegex, 'Invalid Meta Ad Account ID format'),
  }),
});

export const authorizeWriteSchema = z.object({
  body: z.object({
    authorize: z.boolean(),
    confirmation_phrase: z
      .string()
      .trim()
      .optional(),
    note: z.string().trim().max(300).optional(),
  }),
});

export const createMappingSchema = z.object({
  body: z.object({
    meta_ad_account_id: z
      .string()
      .trim()
      .regex(adAccountRegex, 'Invalid Meta Ad Account ID format'),
    meta_ad_id: z.string().trim().min(3, 'meta_ad_id is required'),
    meta_ad_name: z.string().trim().optional(),
    meta_campaign_id: z.string().trim().optional(),
    meta_campaign_name: z.string().trim().optional(),
    meta_adset_id: z.string().trim().optional(),
    meta_creative_id: z.string().trim().optional(),
    adpilot_campaign_id: z
      .string()
      .trim()
      .refine((v) => !v || mongoose.Types.ObjectId.isValid(v), 'Invalid adpilot_campaign_id')
      .optional()
      .nullable(),
    adpilot_creative_id: z
      .string()
      .trim()
      .refine((v) => !v || mongoose.Types.ObjectId.isValid(v), 'Invalid adpilot_creative_id')
      .optional()
      .nullable(),
    origin: z
      .enum(['adpilot_generated', 'uploaded_creative', 'external_meta'])
      .optional(),
    creative_title: z.string().trim().max(200).optional(),
  }),
});

export const mappingIdParamSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1, 'Mapping ID is required'),
  }),
});

export const triggerSyncSchema = z.object({
  body: z.object({
    ad_account_id: z
      .string()
      .trim()
      .regex(adAccountRegex, 'Invalid Meta Ad Account ID format')
      .optional(),
    since: z.string().regex(isoDateRegex, 'since must be YYYY-MM-DD').optional(),
    until: z.string().regex(isoDateRegex, 'until must be YYYY-MM-DD').optional(),
    include_placement_breakdown: z.boolean().optional().default(true),
    include_audience_breakdown: z.boolean().optional().default(false),
    use_unified_attribution_setting: z.boolean().optional().default(true),
    attribution_windows: z
      .array(z.enum(['1d_click', '7d_click', '28d_click', '1d_view', '7d_view']))
      .optional(),
  }),
});

export const analyticsQuerySchema = z.object({
  query: z.object({
    since: z.string().regex(isoDateRegex, 'since must be YYYY-MM-DD').optional(),
    until: z.string().regex(isoDateRegex, 'until must be YYYY-MM-DD').optional(),
    adAccountId: z.string().trim().optional(),
    campaignId: z.string().trim().optional(),
    origin: z.enum(['', 'adpilot_generated', 'uploaded_creative', 'external_meta']).optional(),
    includeTestFixtures: z.enum(['true', 'false']).optional(),
  }),
});

export const updateBudgetActionSchema = z.object({
  body: z.object({
    entity_id: z.string().trim().min(3, 'Meta campaign or adset ID is required'),
    ad_account_id: z.string().trim().regex(adAccountRegex, 'Invalid ad_account_id'),
    daily_budget_minor_units: z.number().int().positive('Budget must be a positive integer in minor currency units'),
    explicit_user_authorization: z.literal(true, {
      errorMap: () => ({ message: 'Explicit user authorization flag must be true before modifying budgets' }),
    }),
  }),
});

export const publishAdActionSchema = z.object({
  body: z.object({
    ad_id: z.string().trim().min(3, 'Meta ad ID is required'),
    ad_account_id: z.string().trim().regex(adAccountRegex, 'Invalid ad_account_id'),
    target_status: z.enum(['ACTIVE', 'PAUSED']),
    explicit_user_authorization: z.literal(true, {
      errorMap: () => ({ message: 'Explicit user authorization flag must be true before publishing or pausing ads' }),
    }),
  }),
});

