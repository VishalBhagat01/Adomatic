import { Router } from 'express';
import {
  getAnalyticsOverview,
  getCreativeComparison,
  getPerformanceTrends,
  getBreakdownAnalysis,
} from '../controllers/metaController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { attachOwnershipContext } from '../middleware/ownership.js';
import { analyticsQuerySchema } from '../validators/metaValidators.js';

const router = Router();
router.use(attachOwnershipContext);

router.get('/overview', validateRequest(analyticsQuerySchema), getAnalyticsOverview);
router.get('/creatives', validateRequest(analyticsQuerySchema), getCreativeComparison);
router.get('/trends', validateRequest(analyticsQuerySchema), getPerformanceTrends);
router.get('/breakdowns', validateRequest(analyticsQuerySchema), getBreakdownAnalysis);

export default router;

