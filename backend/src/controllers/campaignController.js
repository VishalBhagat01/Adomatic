import { CampaignService } from '../services/campaignService.js';

export async function createCampaign(req, res, next) {
  try {
    const { product_url, user_prompt, formats, placements } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || null;

    const result = await CampaignService.createCampaign({
      tenantId: req.tenantId,
      userId: req.userId,
      product_url,
      user_prompt,
      formats,
      placements,
      idempotencyKey,
    });

    // If duplicate was matched via idempotency, return 200 with notice; otherwise 201 Created
    const statusCode = result.isDuplicate ? 200 : 201;

    return res.status(statusCode).json({
      success: true,
      message: result.isDuplicate ? 'Existing campaign matched by idempotency key' : 'Campaign created and queued successfully',
      data: result.campaign,
      isDuplicate: result.isDuplicate,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaigns(req, res, next) {
  try {
    const { page, limit, status, search } = req.query;

    const result = await CampaignService.getCampaigns({
      tenantId: req.tenantId,
      page,
      limit,
      status,
      search,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignById(req, res, next) {
  try {
    const { id } = req.params;
    const campaign = await CampaignService.getCampaignById(id, req.tenantId);

    return res.status(200).json({
      success: true,
      data: campaign,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignStatus(req, res, next) {
  try {
    const { id } = req.params;
    const statusData = await CampaignService.getCampaignStatus(id, req.tenantId);

    return res.status(200).json({
      success: true,
      data: statusData,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignCreatives(req, res, next) {
  try {
    const { id } = req.params;
    const creativesData = await CampaignService.getCampaignCreatives(id, req.tenantId);

    return res.status(200).json({
      success: true,
      data: creativesData,
    });
  } catch (err) {
    next(err);
  }
}

export async function regenerateCampaign(req, res, next) {
  try {
    const { id } = req.params;
    const regenerated = await CampaignService.regenerateCampaign(id, req.tenantId);

    return res.status(200).json({
      success: true,
      message: 'Campaign regeneration queued successfully',
      data: regenerated,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteCampaign(req, res, next) {
  try {
    const { id } = req.params;
    const result = await CampaignService.deleteCampaign(id, req.tenantId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
}

