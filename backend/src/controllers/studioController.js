import { CampaignService } from '../services/campaignService.js';
import { CampaignRepository } from '../repositories/campaignRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { CreativeStudioService } from '../services/creativeStudioService.js';
import { agentClient } from '../services/agentClient.js';
import { campaignEvents, CAMPAIGN_EVENTS } from '../events/campaignEvents.js';
import { STAGE_PROGRESS } from '../models/Campaign.js';
import { StorageService } from '../services/storageService.js';

const storageService = new StorageService();

function computeMissingFields(product) {
  if (!product) return ['product_name', 'description', 'price', 'images', 'specifications'];
  const missing = [];
  if (!product.product_name) missing.push('product_name');
  if (!product.brand) missing.push('brand');
  if (!product.category) missing.push('category');
  if (!product.description) missing.push('description');
  if (product.price === null || product.price === undefined) missing.push('price');
  if (!Array.isArray(product.images) || product.images.length === 0) missing.push('images');
  if (!product.specifications || Object.keys(product.specifications).length === 0) missing.push('specifications');
  if (!Array.isArray(product.features) || product.features.length === 0) missing.push('features');
  return missing;
}

export async function previewProduct(req, res, next) {
  try {
    const { product_url, force_js = false } = req.body;
    const extraction = await agentClient.extractProduct(product_url, {
      forceJs: force_js,
      timeoutMs: 45000,
    });

    const product = extraction?.data || extraction?.product || null;
    const warnings = Array.isArray(extraction?.warnings)
      ? extraction.warnings
      : Array.isArray(extraction?.diagnostics?.warnings)
        ? extraction.diagnostics.warnings
        : [];
    const missingFields = computeMissingFields(product);

    return res.status(extraction?.success === false ? 422 : 200).json({
      success: extraction?.success !== false && Boolean(product),
      data: {
        product,
        warnings,
        missingFields,
        diagnostics: extraction?.diagnostics || null,
        error: extraction?.error || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getDashboardSummary(req, res, next) {
  try {
    const [campaignStats, creativeStats] = await Promise.all([
      CampaignRepository.getDashboardStats(req.tenantId, 6),
      CreativeRepository.getAggregateStats(req.tenantId),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totals: {
          totalCampaigns: campaignStats.totalCampaigns,
          generatedCreatives: creativeStats.totalCreatives,
          approvedCreatives: creativeStats.approvedCreatives,
          rejectedCreatives: creativeStats.rejectedCreatives,
          pendingCreatives: creativeStats.pendingCreatives,
          imageCreatives: creativeStats.imageCreatives,
          videoCreatives: creativeStats.videoCreatives,
        },
        statusCounts: campaignStats.statusCounts,
        recentCampaigns: campaignStats.recentCampaigns,
        recentActivity: campaignStats.recentActivity,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignDetails(req, res, next) {
  try {
    const { id } = req.params;
    const details = await CampaignService.getCampaignDetails(id, req.tenantId);

    const formattedCreatives = details.creatives.map((c) => {
      const plain = typeof c.toJSON === 'function' ? c.toJSON() : { ...c, id: c.id || String(c._id) };
      return {
        ...plain,
        mediaUrl: `/api/creatives/${plain.id}/media`,
        downloadUrl: `/api/creatives/${plain.id}/media?download=1`,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        ...details,
        creatives: formattedCreatives,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function streamCampaignEvents(req, res, next) {
  try {
    const { id } = req.params;
    const campaign = await CampaignService.getCampaignById(id, req.tenantId);
    const creativesBundle = await CreativeRepository.findByCampaignId(id, req.tenantId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const writeEvent = (eventName, payload) => {
      if (res.writableEnded) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    writeEvent('snapshot', {
      campaignId: String(campaign.id),
      name: campaign.name,
      status: campaign.status,
      currentStage: campaign.currentStage,
      progress: campaign.progress ?? STAGE_PROGRESS[campaign.status] ?? 0,
      retryCount: campaign.retryCount || 0,
      errorMetadata: campaign.errorMetadata || null,
      stageHistory: campaign.stageHistory || [],
      creativeCount: creativesBundle.count.creatives,
      timestamp: new Date().toISOString(),
    });

    const targetId = String(campaign.id);

    const onStageChanged = (payload) => {
      if (String(payload.campaignId) === targetId) {
        writeEvent('stage_changed', {
          ...payload,
          progress: payload.metadata?.progress ?? STAGE_PROGRESS[payload.toStage] ?? 0,
        });
      }
    };

    const onProgress = (payload) => {
      if (String(payload.campaignId) === targetId) {
        writeEvent('progress', payload);
      }
    };

    const onRetry = (payload) => {
      if (String(payload.campaignId) === targetId) {
        writeEvent('retry', payload);
      }
    };

    const onCreativeGenerated = (payload) => {
      if (String(payload.campaignId) === targetId) {
        writeEvent('creative_generated', {
          campaignId: targetId,
          creativeId: payload.creative?.id || null,
          title: payload.creative?.title || null,
          assetType: payload.creative?.assetType || null,
          timestamp: payload.timestamp,
        });
      }
    };

    const onCompleted = (payload) => {
      if (String(payload.campaignId) === targetId) {
        writeEvent('completed', { ...payload, progress: 100 });
      }
    };

    const onFailed = (payload) => {
      if (String(payload.campaignId) === targetId) {
        writeEvent('failed', payload);
      }
    };

    campaignEvents.on(CAMPAIGN_EVENTS.STAGE_CHANGED, onStageChanged);
    campaignEvents.on(CAMPAIGN_EVENTS.PROGRESS, onProgress);
    campaignEvents.on(CAMPAIGN_EVENTS.RETRY, onRetry);
    campaignEvents.on(CAMPAIGN_EVENTS.CREATIVE_GENERATED, onCreativeGenerated);
    campaignEvents.on(CAMPAIGN_EVENTS.COMPLETED, onCompleted);
    campaignEvents.on(CAMPAIGN_EVENTS.FAILED, onFailed);

    const keepalive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 15000);
    if (typeof keepalive.unref === 'function') {
      keepalive.unref();
    }

    req.on('close', () => {
      clearInterval(keepalive);
      campaignEvents.off(CAMPAIGN_EVENTS.STAGE_CHANGED, onStageChanged);
      campaignEvents.off(CAMPAIGN_EVENTS.PROGRESS, onProgress);
      campaignEvents.off(CAMPAIGN_EVENTS.RETRY, onRetry);
      campaignEvents.off(CAMPAIGN_EVENTS.CREATIVE_GENERATED, onCreativeGenerated);
      campaignEvents.off(CAMPAIGN_EVENTS.COMPLETED, onCompleted);
      campaignEvents.off(CAMPAIGN_EVENTS.FAILED, onFailed);
      if (!res.writableEnded) {
        res.end();
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function listCreatives(req, res, next) {
  try {
    const result = await CreativeStudioService.listCreatives({
      tenantId: req.tenantId,
      ...req.query,
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

export async function getCreativeDetail(req, res, next) {
  try {
    const { creativeId } = req.params;
    const detail = await CreativeStudioService.getCreativeDetail(creativeId, req.tenantId);

    return res.status(200).json({
      success: true,
      data: detail,
    });
  } catch (err) {
    next(err);
  }
}

export async function patchCreative(req, res, next) {
  try {
    const { creativeId } = req.params;
    const updated = await CreativeStudioService.updateCreative(creativeId, req.tenantId, req.body);

    return res.status(200).json({
      success: true,
      message: 'Creative updated successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function regenerateSingleCreative(req, res, next) {
  try {
    const { creativeId } = req.params;
    const regenerated = await CreativeStudioService.regenerateCreative(
      creativeId,
      req.tenantId,
      req.body || {}
    );

    return res.status(200).json({
      success: true,
      message: 'Creative regenerated cleanly without restarting campaign',
      data: regenerated,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCreativeMedia(req, res, next) {
  try {
    const { creativeId } = req.params;
    const isDownload = req.query.download === '1' || req.query.download === 'true';
    const media = await CreativeStudioService.getCreativeMediaBuffer(creativeId, req.tenantId);

    if (media.redirectUrl && !media.buffer) {
      return res.redirect(302, media.redirectUrl);
    }

    const total = media.buffer.length;
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${media.filename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${media.filename}"`);
    }

    const range = req.headers.range;
    if (range && !isDownload) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
        if (start >= 0 && start <= end && end < total) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', end - start + 1);
          return res.send(media.buffer.subarray(start, end + 1));
        }
      }
    }

    res.setHeader('Content-Length', total);
    return res.status(200).send(media.buffer);
  } catch (err) {
    next(err);
  }
}

export async function getCreativeDownloadUrl(req, res, next) {
  try {
    const { creativeId } = req.params;
    const detail = await CreativeStudioService.getCreativeDetail(creativeId, req.tenantId);
    const cr = detail.creative;

    let presigned = null;
    try {
      presigned = await storageService.getPresignedDownloadUrl(
        cr.bucket || 'adpilot-creatives',
        cr.storageKey,
        900
      );
    } catch {
      presigned = null;
    }

    return res.status(200).json({
      success: true,
      data: {
        creativeId: cr.id,
        proxyDownloadUrl: `/api/creatives/${cr.id}/media?download=1`,
        presignedUrl: presigned?.downloadUrl || cr.presignedUrl || null,
        expiresAt: presigned?.expiresAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

