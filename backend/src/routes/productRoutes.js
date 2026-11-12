import { Router } from 'express';
import { previewProduct } from '../controllers/studioController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { attachOwnershipContext } from '../middleware/ownership.js';
import { previewProductSchema } from '../validators/campaignValidators.js';

const router = Router();
router.use(attachOwnershipContext);

router.post('/preview', validateRequest(previewProductSchema), previewProduct);

export default router;

