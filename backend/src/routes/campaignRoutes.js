import { Router } from 'express';
import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  getCampaignStatus,
  getCampaignCreatives,
  regenerateCampaign,
  deleteCampaign,
} from '../controllers/campaignController.js';
import {
  getCampaignDetails,
  streamCampaignEvents,
} from '../controllers/studioController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { attachOwnershipContext } from '../middleware/ownership.js';
import { campaignCreationLimiter } from '../middleware/rateLimiter.js';
import {
  createCampaignSchema,
  queryCampaignsSchema,
  campaignIdParamSchema,
} from '../validators/campaignValidators.js';

const router = Router();

// Apply ownership context extraction to all campaign endpoints
router.use(attachOwnershipContext);

// 1. Create Campaign
router.post(
  '/',
  campaignCreationLimiter,
  validateRequest(createCampaignSchema),
  createCampaign
);

// 2. List Campaigns (Paginated, Filterable)
router.get(
  '/',
  validateRequest(queryCampaignsSchema),
  getCampaigns
);

// 3. Get Campaign By ID
router.get(
  '/:id',
  validateRequest(campaignIdParamSchema),
  getCampaignById
);

// 4. Get Campaign Lifecycle Status & Progress
router.get(
  '/:id/status',
  validateRequest(campaignIdParamSchema),
  getCampaignStatus
);

// 5. Get Campaign Generated Creatives & Copies
router.get(
  '/:id/creatives',
  validateRequest(campaignIdParamSchema),
  getCampaignCreatives
);

// 5b. Get Full Consolidated Campaign Details
router.get(
  '/:id/details',
  validateRequest(campaignIdParamSchema),
  getCampaignDetails
);

// 5c. Stream Real-time Campaign Execution Events (SSE)
router.get(
  '/:id/events',
  validateRequest(campaignIdParamSchema),
  streamCampaignEvents
);

// 6. Regenerate Campaign
router.post(
  '/:id/regenerate',
  validateRequest(campaignIdParamSchema),
  regenerateCampaign
);

// 7. Delete Campaign (Soft-delete)
router.delete(
  '/:id',
  validateRequest(campaignIdParamSchema),
  deleteCampaign
);

export default router;

