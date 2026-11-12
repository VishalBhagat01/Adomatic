import { Router } from 'express';
import {
  getMetaStatus,
  startMetaOAuth,
  handleMetaOAuthCallback,
  connectMetaToken,
  selectAdAccount,
  authorizeMetaWrites,
  disconnectMeta,
  listMetaCampaigns,
  listMetaAds,
  listMappings,
  createMapping,
  deleteMapping,
  triggerMetaSync,
  triggerFixtureSync,
  clearFixtures,
  getSyncHistory,
  publishOrPauseMetaAd,
  updateMetaBudget,
} from '../controllers/metaController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { attachOwnershipContext } from '../middleware/ownership.js';
import {
  oauthStartSchema,
  connectTokenSchema,
  selectAdAccountSchema,
  authorizeWriteSchema,
  createMappingSchema,
  mappingIdParamSchema,
  triggerSyncSchema,
  publishAdActionSchema,
  updateBudgetActionSchema,
} from '../validators/metaValidators.js';

const router = Router();

// OAuth callback receives direct browser redirect from Meta with CSRF state
router.get('/oauth/callback', handleMetaOAuthCallback);

router.use(attachOwnershipContext);

router.get('/status', getMetaStatus);
router.get('/oauth/start', validateRequest(oauthStartSchema), startMetaOAuth);
router.post('/connect/token', validateRequest(connectTokenSchema), connectMetaToken);
router.post('/ad-account', validateRequest(selectAdAccountSchema), selectAdAccount);
router.post('/authorize-write', validateRequest(authorizeWriteSchema), authorizeMetaWrites);
router.delete('/connection', disconnectMeta);

router.get('/campaigns', listMetaCampaigns);
router.get('/ads', listMetaAds);
router.get('/mappings', listMappings);
router.post('/mappings', validateRequest(createMappingSchema), createMapping);
router.delete('/mappings/:id', validateRequest(mappingIdParamSchema), deleteMapping);

router.post('/sync', validateRequest(triggerSyncSchema), triggerMetaSync);
router.post('/sync/fixtures', triggerFixtureSync);
router.delete('/fixtures', clearFixtures);
router.get('/sync-runs', getSyncHistory);

router.post('/actions/publish-ad', validateRequest(publishAdActionSchema), publishOrPauseMetaAd);
router.post('/actions/budget', validateRequest(updateBudgetActionSchema), updateMetaBudget);

export default router;

