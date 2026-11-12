import { Router } from 'express';
import { getDashboardSummary } from '../controllers/studioController.js';
import { attachOwnershipContext } from '../middleware/ownership.js';

const router = Router();
router.use(attachOwnershipContext);

router.get('/summary', getDashboardSummary);

export default router;

