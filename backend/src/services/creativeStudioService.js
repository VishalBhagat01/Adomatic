import path from 'node:path';
import { CampaignRepository } from '../repositories/campaignRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { StorageService } from './storageService.js';
import { agentClient } from './agentClient.js';
import { campaignEvents } from '../events/campaignEvents.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { extractReferenceImageUrls } from '../utils/productUtils.js';
import { env } from '../config/env.js';

const storageService = new StorageService();

const EXT_CONTENT_TYPE_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function guessContentType(creative) {
  const ext = path.extname(creative?.storageKey || '').toLowerCase();
  if (EXT_CONTENT_TYPE_MAP[ext]) return EXT_CONTENT_TYPE_MAP[ext];
  return creative?.assetType === 'video' ? 'video/mp4' : 'image/png';
}

function toPlainObject(doc) {
  if (!doc) return null;
  if (typeof doc.toJSON === 'function') return doc.toJSON();
  return { ...doc, id: doc.id || String(doc._id) };
}

export class CreativeStudioService {
  /**
   * List creatives across campaigns with linked ad copy and campaign titles.
   */
  static async listCreatives(filters) {
    const result = await CreativeRepository.findAll(filters);
    const campaignCache = new Map();

    const enrichedItems = await Promise.all(
      result.items.map(async (item) => {
        const plain = toPlainObject(item);
        const cid = String(plain.campaignId);
        if (!campaignCache.has(cid)) {
          const cp = await CampaignRepository.findById(cid, filters.tenantId);
          campaignCache.set(cid, cp ? cp.name : 'Campaign');
        }
        const adCopies = await CreativeRepository.findAdCopiesByCreativeId(
          plain.id,
          cid,
          filters.tenantId
        );
        return {
          ...plain,
          campaignName: campaignCache.get(cid),
          mediaUrl: `/api/creatives/${plain.id}/media`,
          downloadUrl: `/api/creatives/${plain.id}/media?download=1`,
          adCopies: adCopies.map(toPlainObject),
        };
      })
    );

    return {
      items: enrichedItems,
      pagination: result.pagination,
    };
  }

  /**
   * Get single creative detail along with parent campaign metadata and ad copy variants.
   */
  static async getCreativeDetail(creativeId, tenantId) {
    const creative = await CreativeRepository.findById(creativeId, tenantId);
    if (!creative) {
      throw new NotFoundError(`Creative ${creativeId} not found`);
    }

    const plain = toPlainObject(creative);
    const [campaign, adCopies] = await Promise.all([
      CampaignRepository.findById(plain.campaignId, tenantId),
      CreativeRepository.findAdCopiesByCreativeId(plain.id, plain.campaignId, tenantId),
    ]);

    return {
      creative: {
        ...plain,
        mediaUrl: `/api/creatives/${plain.id}/media`,
        downloadUrl: `/api/creatives/${plain.id}/media?download=1`,
      },
      campaign: campaign ? toPlainObject(campaign) : null,
      adCopies: adCopies.map(toPlainObject),
    };
  }

  /**
   * Update editable Creative Editor fields (copy, overlays, background, instructions, approval)
   * without modifying generated binary assets.
   */
  static async updateCreative(creativeId, tenantId, edits = {}) {
    const existing = await CreativeRepository.findById(creativeId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Creative ${creativeId} not found`);
    }

    const plain = toPlainObject(existing);
    const patch = {};

    if (edits.title !== undefined) patch.title = edits.title;
    if (edits.backgroundDirection !== undefined) patch.backgroundDirection = edits.backgroundDirection;
    if (edits.creativeInstructions !== undefined) patch.creativeInstructions = edits.creativeInstructions;

    if (edits.overlaySpec || edits.headline !== undefined || edits.callToAction !== undefined) {
      patch.overlaySpec = {
        ...(plain.overlaySpec || {}),
        ...(edits.overlaySpec || {}),
        ...(edits.headline !== undefined ? { headline: edits.headline } : {}),
        ...(edits.callToAction !== undefined ? { cta: edits.callToAction } : {}),
      };
    }

    if (edits.approvalStatus !== undefined) {
      patch.approvalStatus = edits.approvalStatus;
      patch.approved = edits.approvalStatus === 'approved';
      patch.status = edits.approvalStatus === 'approved' ? 'approved' : 'ready';
    }

    const updatedCreative =
      Object.keys(patch).length > 0
        ? await CreativeRepository.updateCreative(plain.id, tenantId, patch)
        : existing;

    // Synchronize editable copy variants
    const hasCopyEdits =
      edits.headline !== undefined ||
      edits.headlines !== undefined ||
      edits.primaryText !== undefined ||
      edits.primaryTexts !== undefined ||
      edits.descriptions !== undefined ||
      edits.callToAction !== undefined;

    if (hasCopyEdits) {
      const copyPatch = {};
      if (Array.isArray(edits.headlines) && edits.headlines.length > 0) {
        copyPatch.headlines = edits.headlines;
        copyPatch.headline = edits.headlines[0];
      } else if (edits.headline !== undefined) {
        copyPatch.headline = edits.headline;
        copyPatch.headlines = [edits.headline];
      }

      if (Array.isArray(edits.primaryTexts) && edits.primaryTexts.length > 0) {
        copyPatch.primaryTexts = edits.primaryTexts;
        copyPatch.primaryText = edits.primaryTexts[0];
      } else if (edits.primaryText !== undefined) {
        copyPatch.primaryText = edits.primaryText;
        copyPatch.primaryTexts = [edits.primaryText];
      }

      if (Array.isArray(edits.descriptions)) {
        copyPatch.descriptions = edits.descriptions;
        copyPatch.description = edits.descriptions[0] || '';
      }

      if (edits.callToAction !== undefined) {
        copyPatch.callToAction = edits.callToAction;
      }

      await CreativeRepository.upsertAdCopyForCreative(
        plain.campaignId,
        plain.id,
        tenantId,
        copyPatch
      );
    }

    campaignEvents.emitCreativeUpdated(plain.campaignId, toPlainObject(updatedCreative));
    return await this.getCreativeDetail(plain.id, tenantId);
  }

  /**
   * Regenerate an individual creative with edited instructions, overlays, and background direction
   * while preserving version history and leaving parent campaign status untouched.
   */
  static async regenerateCreative(creativeId, tenantId, overrides = {}) {
    // Apply metadata/copy edits first if included
    const preUpdated = await this.updateCreative(creativeId, tenantId, overrides);
    const current = preUpdated.creative;
    const campaign = preUpdated.campaign;

    if (!campaign || !campaign.productData || !campaign.strategyData) {
      throw new BadRequestError(
        'Cannot selectively regenerate creative because parent campaign product/strategy context is missing'
      );
    }

    const refUrls = extractReferenceImageUrls(campaign.productData?.images);
    const overlayHeadline = overrides.overlaySpec?.headline ?? overrides.headline ?? current.overlaySpec?.headline ?? current.hook;
    const overlayCta = overrides.overlaySpec?.cta ?? overrides.callToAction ?? current.overlaySpec?.cta ?? 'Shop Now';
    const backgroundDirection = overrides.backgroundDirection ?? current.backgroundDirection ?? '';
    const creativeInstructions = overrides.creativeInstructions ?? current.creativeInstructions ?? '';

    if (current.assetType === 'video') {
      const storyboard = structuredClone(current.blueprint || {});
      if (overlayHeadline) storyboard.opening_hook = overlayHeadline;
      if (overlayCta) storyboard.final_cta = overlayCta;
      if (Array.isArray(storyboard.scene_sequence) && storyboard.scene_sequence.length > 0) {
        const s0 = storyboard.scene_sequence[0];
        if (backgroundDirection) {
          s0.scene_description = `${s0.scene_description || ''} (Background direction: ${backgroundDirection})`.trim();
        }
        if (creativeInstructions) {
          s0.scene_description = `${s0.scene_description || ''} (${creativeInstructions})`.trim();
        }
      }
      if (storyboard.video_generation_prompt && typeof storyboard.video_generation_prompt === 'object') {
        const extraVideoPrompt = [
          backgroundDirection ? `Background direction: ${backgroundDirection}` : '',
          creativeInstructions ? `Studio instructions: ${creativeInstructions}` : '',
        ]
          .filter(Boolean)
          .join('. ');
        if (extraVideoPrompt) {
          storyboard.video_generation_prompt.positive_prompt = [
            storyboard.video_generation_prompt.positive_prompt,
            extraVideoPrompt,
          ]
            .filter(Boolean)
            .join('. ');
        }
      }

      const vidRes = await agentClient.generateVideo({
        campaign_id: String(campaign.id),
        storyboard,
        product_data: campaign.productData,
        reference_image_urls: refUrls.length > 0 ? refUrls : null,
        execute_sync: true,
      });

      const fv = vidRes?.final_video;
      if (!fv?.object_key) {
        throw new BadRequestError('Video regeneration did not produce a final assembled video artifact');
      }

      let evalRes = null;
      try {
        evalRes = await agentClient.evaluateCreative({
          campaign_id: String(campaign.id),
          creative_id: fv.video_id,
          format: 'video',
          product_data: campaign.productData,
          marketing_strategy: campaign.strategyData,
          video_storyboard: storyboard,
          object_key: fv.object_key,
          creative_url: fv.presigned_url || undefined,
          reference_image_urls: refUrls.length > 0 ? refUrls : null,
        });
      } catch {
        evalRes = current.evaluation || null;
      }

      const isApproved = evalRes ? Boolean(evalRes.approved) : Boolean(fv.validation?.approved ?? fv.validation?.passed);
      await CreativeRepository.pushCreativeVersion(current.id, tenantId, {
        creativeKey: fv.video_id,
        storageKey: fv.object_key,
        bucket: fv.bucket || current.bucket || 'adpilot-creatives',
        presignedUrl: fv.presigned_url || null,
        aspectRatio: fv.aspect_ratio || overrides.aspectRatio || current.aspectRatio,
        dimensions: { width: fv.width || 1080, height: fv.height || 1920 },
        fileSizeBytes: fv.file_size_bytes || 0,
        durationSeconds: fv.duration_seconds || current.durationSeconds,
        hasAudio: Boolean(fv.has_audio),
        backgroundDirection,
        creativeInstructions,
        blueprint: storyboard,
        evaluation: evalRes,
        approved: isApproved,
        approvalStatus: isApproved ? 'approved' : 'needs_review',
        status: isApproved ? 'approved' : 'ready',
        generationCostUsd: Number(vidRes.total_estimated_cost_usd || 0),
      });
    } else {
      const blueprint = structuredClone(current.blueprint || {});
      if (backgroundDirection) blueprint.background_direction = backgroundDirection;
      if (overlayHeadline) blueprint.hook = overlayHeadline;
      if (overrides.aspectRatio) blueprint.aspect_ratio = overrides.aspectRatio;

      const appendedNotes = [
        backgroundDirection ? `Background direction: ${backgroundDirection}` : '',
        creativeInstructions ? `Additional studio instructions: ${creativeInstructions}` : '',
      ]
        .filter(Boolean)
        .join('. ');

      if (blueprint.image_generation_prompt && typeof blueprint.image_generation_prompt === 'object') {
        blueprint.image_generation_prompt.positive_prompt = [
          blueprint.image_generation_prompt.positive_prompt,
          appendedNotes,
        ]
          .filter(Boolean)
          .join('. ');
      } else {
        blueprint.image_generation_prompt = [blueprint.image_generation_prompt, appendedNotes]
          .filter(Boolean)
          .join('. ');
      }

      const imgRes = await agentClient.generateImages({
        campaign_id: String(campaign.id),
        blueprint,
        marketing_strategy: campaign.strategyData,
        product_data: campaign.productData,
        aspect_ratio: overrides.aspectRatio || blueprint.aspect_ratio || current.aspectRatio || '1:1',
        num_variations: 1,
        apply_deterministic_overlay: true,
        overlay_headline: overlayHeadline ? String(overlayHeadline).slice(0, 120) : undefined,
        overlay_cta: overlayCta ? String(overlayCta).slice(0, 60) : undefined,
        reference_image_urls: refUrls.length > 0 ? refUrls : null,
      });

      const bestAsset = imgRes?.assets?.find((a) => a.approved) || imgRes?.assets?.[0];
      if (!bestAsset) {
        throw new BadRequestError('Image regeneration produced no candidate assets');
      }

      const objectKey = bestAsset.overlay_object_key || bestAsset.object_key;
      const presignedUrl = bestAsset.overlay_presigned_url || bestAsset.presigned_url || null;

      let evalRes = null;
      try {
        evalRes = await agentClient.evaluateCreative({
          campaign_id: String(campaign.id),
          creative_id: bestAsset.creative_id,
          format: 'image',
          product_data: campaign.productData,
          marketing_strategy: campaign.strategyData,
          image_blueprint: blueprint,
          object_key: objectKey,
          creative_url: presignedUrl || undefined,
          reference_image_urls: refUrls.length > 0 ? refUrls : null,
        });
      } catch {
        evalRes = current.evaluation || null;
      }

      const isApproved = evalRes ? Boolean(evalRes.approved) : Boolean(bestAsset.approved);
      await CreativeRepository.pushCreativeVersion(current.id, tenantId, {
        creativeKey: bestAsset.creative_id,
        storageKey: objectKey,
        bucket: bestAsset.metadata?.bucket || current.bucket || 'adpilot-creatives',
        presignedUrl,
        aspectRatio: bestAsset.aspect_ratio || blueprint.aspect_ratio || current.aspectRatio,
        dimensions: { width: bestAsset.width || 1080, height: bestAsset.height || 1080 },
        format: bestAsset.mime_type === 'image/jpeg' ? 'jpg' : 'png',
        promptUsed:
          bestAsset.prompt_used ||
          (typeof blueprint.image_generation_prompt === 'object'
            ? blueprint.image_generation_prompt?.positive_prompt
            : blueprint.image_generation_prompt) ||
          '',
        backgroundDirection,
        creativeInstructions,
        blueprint,
        evaluation: evalRes,
        approved: isApproved,
        approvalStatus: isApproved ? 'approved' : 'needs_review',
        status: isApproved ? 'approved' : 'ready',
        generationCostUsd: Number(bestAsset.cost?.estimated_cost_usd || imgRes.total_estimated_cost_usd || 0),
      });
    }

    const updated = await this.getCreativeDetail(current.id, tenantId);
    campaignEvents.emitCreativeUpdated(String(campaign.id), updated.creative);
    return updated;
  }

  /**
   * Resolve binary media buffer for previewing or downloading a creative.
   */
  static async getCreativeMediaBuffer(creativeId, tenantId) {
    const creative = await CreativeRepository.findById(creativeId, tenantId);
    if (!creative) {
      throw new NotFoundError(`Creative ${creativeId} not found`);
    }

    const bucket = creative.bucket || env.STORAGE_BUCKET_CREATIVES;
    const key = creative.storageKey;
    const contentType = guessContentType(creative);
    const ext = creative.format || (creative.assetType === 'video' ? 'mp4' : 'png');
    const safeTitle = (creative.title || creative.id || 'creative')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 48);
    const filename = `${safeTitle}-v${creative.version || 1}.${ext}`;

    // 1. Primary path: stream from private MinIO / S3 storage
    try {
      const buffer = await storageService.downloadBuffer(bucket, key);
      if (buffer && buffer.length > 0) {
        return { buffer, contentType, filename };
      }
    } catch {
      // Fallback handled below when running locally without live MinIO
    }

    // 2. Fallback: inline base64 payload stored during mocked / offline evaluation
    const inlineB64 = creative.metadata?.inlineBase64;
    if (typeof inlineB64 === 'string' && inlineB64.length > 0) {
      const cleaned = inlineB64.includes(',') ? inlineB64.split(',').pop() : inlineB64;
      return {
        buffer: Buffer.from(cleaned, 'base64'),
        contentType,
        filename,
      };
    }

    // 3. Fallback: redirect info if presignedUrl exists
    if (creative.presignedUrl) {
      return {
        redirectUrl: creative.presignedUrl,
        contentType,
        filename,
      };
    }

    throw new NotFoundError(`Media object for creative ${creativeId} is not available in storage`);
  }
}

