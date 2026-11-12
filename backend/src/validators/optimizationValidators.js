import { z } from 'zod';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const analysisQuerySchema = z.object({
  query: z.object({
    since: z.string().regex(isoDateRegex).optional(),
    until: z.string().regex(isoDateRegex).optional(),
    adAccountId: z.string().optional(),
    campaignId: z.string().optional(),
    origin: z.string().optional(),
    includeTestFixtures: z.enum(['true', 'false']).optional(),
  }),
});

export const updateInsightStatusSchema = z.object({
  params: z.object({
    id: z.string().min(4),
  }),
  body: z.object({
    actionStatus: z.enum(['pending', 'applied', 'dismissed']),
  }),
});

export const memoryQuerySchema = z.object({
  query: z.object({
    productCategory: z.string().optional(),
    placement: z.string().optional(),
    format: z.enum(['image', 'video']).optional(),
    marketingAngle: z.string().optional(),
    hookType: z.string().optional(),
    outcomeStatus: z.enum(['winning', 'underperforming', 'inconclusive', 'rejected_qa']).optional(),
    userPrompt: z.string().optional(),
  }),
});

const variantInputSchema = z.object({
  variantId: z.string().min(1),
  label: z.string().min(1),
  creativeId: z.string().optional().nullable(),
  metaAdId: z.string().optional().nullable(),
  hookType: z.string().optional(),
  marketingAngle: z.string().optional(),
  placement: z.string().optional(),
  format: z.enum(['image', 'video', 'unknown']).optional(),
  copyStructure: z.string().optional(),
  spend: z.number().min(0).optional(),
  impressions: z.number().min(0).optional(),
  linkClicks: z.number().min(0).optional(),
  conversions: z.number().min(0).optional(),
  revenue: z.number().min(0).optional(),
});

export const createExperimentSchema = z.object({
  body: z.object({
    campaignId: z.string().optional().nullable(),
    name: z.string().trim().min(3),
    hypothesis: z.string().trim().min(5),
    variableTested: z
      .enum([
        'hook_type',
        'marketing_angle',
        'placement',
        'format',
        'opening_scene',
        'product_visibility',
        'ad_copy',
        'multivariate',
      ])
      .optional(),
    objective: z.string().optional(),
    placement: z.string().optional(),
    attributionSetting: z.string().optional(),
    minSampleImpressions: z.number().int().min(100).optional(),
    minSampleClicks: z.number().int().min(5).optional(),
    banditEnabled: z.boolean().optional(),
    variants: z.array(variantInputSchema).min(2),
  }),
});

export const recordExperimentMetricsSchema = z.object({
  params: z.object({
    id: z.string().min(4),
  }),
  body: z.object({
    variants: z.array(
      z.object({
        variantId: z.string().min(1),
        spend: z.number().min(0).optional(),
        impressions: z.number().min(0).optional(),
        linkClicks: z.number().min(0).optional(),
        conversions: z.number().min(0).optional(),
        revenue: z.number().min(0).optional(),
      })
    ).min(1),
    banditEnabled: z.boolean().optional(),
  }),
});

export const approveExperimentSchema = z.object({
  params: z.object({
    id: z.string().min(4),
  }),
  body: z.object({
    approve: z.boolean(),
    confirmationPhrase: z.string().optional().default(''),
  }),
});

