import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import campaignRoutes from './campaignRoutes.js';

const router = Router();

// Mount v1 routes
router.use('/', healthRoutes);
router.use('/campaigns', campaignRoutes);

export default router;
