import { Router } from 'express';
import {
  listCreatives,
  getCreativeDetail,
  patchCreative,
  regenerateSingleCreative,
  getCreativeMedia,
  getCreativeDownloadUrl,
} from '../controllers/studioController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { attachOwnershipContext } from '../middleware/ownership.js';
import {
  queryCreativesSchema,
  creativeIdParamSchema,
  updateCreativeSchema,
  regenerateCreativeSchema,
} from '../validators/campaignValidators.js';

const router = Router();
router.use(attachOwnershipContext);

router.get('/', validateRequest(queryCreativesSchema), listCreatives);
router.get('/:creativeId', validateRequest(creativeIdParamSchema), getCreativeDetail);
router.patch('/:creativeId', validateRequest(updateCreativeSchema), patchCreative);
router.post('/:creativeId/regenerate', validateRequest(regenerateCreativeSchema), regenerateSingleCreative);
router.get('/:creativeId/media', validateRequest(creativeIdParamSchema), getCreativeMedia);
router.get('/:creativeId/download-url', validateRequest(creativeIdParamSchema), getCreativeDownloadUrl);

export default router;

