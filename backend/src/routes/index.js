import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import campaignRoutes from './campaignRoutes.js';
import productRoutes from './productRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import creativeRoutes from './creativeRoutes.js';
import metaRoutes from './metaRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';
import optimizationRoutes from './optimizationRoutes.js';

const router = Router();

// Mount v1 routes
router.use('/', healthRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/products', productRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/creatives', creativeRoutes);
router.use('/meta', metaRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/optimization', optimizationRoutes);

export default router;
