import { Router } from 'express';
import {
  getPerformanceIntelligence,
  listRecommendations,
  generateRecommendations,
  updateRecommendationStatus,
  retrieveLearningMemory,
  syncLearningMemory,
  listExperiments,
  createExperiment,
  recordExperimentMetrics,
  approveExperimentBudget,
  triggerWorkerRecovery,
} from '../controllers/optimizationController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { attachOwnershipContext } from '../middleware/ownership.js';
import {
  analysisQuerySchema,
  updateInsightStatusSchema,
  memoryQuerySchema,
  createExperimentSchema,
  recordExperimentMetricsSchema,
  approveExperimentSchema,
} from '../validators/optimizationValidators.js';

const router = Router();
router.use(attachOwnershipContext);

router.get('/intelligence', validateRequest(analysisQuerySchema), getPerformanceIntelligence);
router.get('/recommendations', listRecommendations);
router.post('/recommendations/generate', generateRecommendations);
router.patch(
  '/recommendations/:id',
  validateRequest(updateInsightStatusSchema),
  updateRecommendationStatus
);

router.get('/memory', validateRequest(memoryQuerySchema), retrieveLearningMemory);
router.post('/memory/sync', syncLearningMemory);

router.get('/experiments', listExperiments);
router.post('/experiments', validateRequest(createExperimentSchema), createExperiment);
router.patch(
  '/experiments/:id/metrics',
  validateRequest(recordExperimentMetricsSchema),
  recordExperimentMetrics
);
router.post(
  '/experiments/:id/approve',
  validateRequest(approveExperimentSchema),
  approveExperimentBudget
);

router.post('/recovery/stalled', triggerWorkerRecovery);

export default router;
