import { Router } from 'express';
import {
  getHealth,
  getLiveness,
  getReadiness,
  getMetricsJson,
  getAgentHealth,
} from '../controllers/healthController.js';

const router = Router();

router.get('/health', getHealth);
router.get('/health/live', getLiveness);
router.get('/health/ready', getReadiness);
router.get('/metrics', getMetricsJson);
router.get('/agent-health', getAgentHealth);

export default router;

