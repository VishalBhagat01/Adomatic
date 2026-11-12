import { CampaignRepository } from '../repositories/campaignRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { env } from '../config/env.js';
import { campaignEvents, CAMPAIGN_EVENTS } from '../events/campaignEvents.js';
import { CAMPAIGN_STATUS, STAGE_PROGRESS } from '../models/Campaign.js';
import { agentClient } from './agentClient.js';
import { CreativeMemoryService } from './creativeMemoryService.js';
import { metricsService } from './metricsService.js';
import { extractReferenceImageUrls, isDegradedProductData } from '../utils/productUtils.js';
import { logger } from '../utils/logger.js';

const DEFAULT_PROMPT =
  'Generate high-converting, product-accurate commercial advertisements aligned with extracted features and target placements.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEffectivePrompt(rawPrompt) {
  const cleaned = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
  return cleaned.length >= 5 ? cleaned : DEFAULT_PROMPT;
}

function derivePlacementSpec(creativePlan, placement) {
  const specs = Array.isArray(creativePlan?.placement_specs) ? creativePlan.placement_specs : [];
  return specs.find((p) => p.placement === placement) || null;
}

class OrchestratorEngine {
  constructor() {
    this.activeRuns = new Map();
    // Skip automatic background execution during node --test unless opted in explicitly
    this.autoExecuteOverride = null;
  }

  setAutoExecute(enabled) {
    this.autoExecuteOverride = enabled;
  }

  shouldAutoExecute() {
    if (this.autoExecuteOverride !== null) {
      return this.autoExecuteOverride;
    }
    if (process.env.DISABLE_AUTO_ORCHESTRATOR === 'true') {
      return false;
    }
    return !process.env.NODE_TEST_CONTEXT;
  }

  scheduleCampaign(campaignId, tenantId, options = {}) {
    const key = String(campaignId);
    if (!options.force && !this.shouldAutoExecute()) {
      return false;
    }
    if (this.activeRuns.has(key)) {
      return false;
    }

    const timer = setTimeout(() => {
      this.runCampaign(key, tenantId, options).catch((err) => {
        logger.error(`Unhandled orchestrator failure for campaign ${key}: ${err.message}`);
      });
    }, options.delayMs ?? 50);

    // Do not block process exit in test teardown if queued
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    return true;
  }

  async _transitionStage(campaignId, tenantId, fromStage, toStage, metadata = {}) {
    const updated = await CampaignRepository.updateStage(campaignId, tenantId, toStage, metadata);
    campaignEvents.emitStageChange(campaignId, fromStage, toStage, {
      progress: STAGE_PROGRESS[toStage] ?? 0,
      ...metadata,
    });
    campaignEvents.emitProgress(campaignId, {
      stage: toStage,
      status: toStage,
      progress: STAGE_PROGRESS[toStage] ?? 0,
      metadata,
    });
    return updated;
  }

  async _withRetry(campaignId, tenantId, stageLabel, fn, maxRetries = 1) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err;
        const isTransient = !err.statusCode || err.statusCode >= 500;
        if (!isTransient || attempt > maxRetries) {
          throw err;
        }
        const campaign = await CampaignRepository.findById(campaignId, tenantId);
        const nextRetryCount = (campaign?.retryCount || 0) + 1;
        await CampaignRepository.updateArtifacts(campaignId, tenantId, {
          retryCount: nextRetryCount,
        });
        campaignEvents.emitRetry(campaignId, {
          stage: stageLabel,
          attempt,
          retryCount: nextRetryCount,
          error: err.message,
        });
        await sleep(250 * attempt);
      }
    }
    throw lastError;
  }

  async runCampaign(campaignId, tenantId, { preExtractedProduct = null, referenceImageUrls = null } = {}) {
    const id = String(campaignId);
    if (this.activeRuns.has(id)) {
      return this.activeRuns.get(id);
    }

    const runPromise = this._executePipeline(id, tenantId, {
      preExtractedProduct,
      referenceImageUrls,
    }).finally(() => {
      this.activeRuns.delete(id);
    });

    this.activeRuns.set(id, runPromise);
    return runPromise;
  }

  async _executePipeline(campaignId, tenantId, { preExtractedProduct = null, referenceImageUrls = null } = {}) {
    let currentStage = CAMPAIGN_STATUS.QUEUED;
    const startedAt = Date.now();
    const warnings = [];
    let totalCostUsd = 0;

    try {
      const campaign = await CampaignRepository.findById(campaignId, tenantId);
      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found for orchestration`);
      }

      const effectivePrompt = getEffectivePrompt(campaign.userPrompt);
      const rawFormats = Array.isArray(campaign.formats) && campaign.formats.length > 0 ? campaign.formats : ['image'];
      const formats = env.ENABLE_VIDEO_GENERATION
        ? rawFormats
        : rawFormats.filter((fmt) => fmt !== 'video');
      if (formats.length === 0) {
        throw new Error(
          'Video generation is disabled (ENABLE_VIDEO_GENERATION=false). Only image campaigns are currently enabled.'
        );
      }
      if (!env.ENABLE_VIDEO_GENERATION && rawFormats.includes('video')) {
        warnings.push('Video format skipped because ENABLE_VIDEO_GENERATION is set to false (image-only mode).');
      }
      const placements =
        Array.isArray(campaign.placements) && campaign.placements.length > 0
          ? campaign.placements
          : ['instagram_feed'];

      // 1. EXTRACTING_PRODUCT
      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.EXTRACTING_PRODUCT, {
        message: 'Extracting and validating product page intelligence',
      });
      currentStage = CAMPAIGN_STATUS.EXTRACTING_PRODUCT;

      const overrideRefUrls = extractReferenceImageUrls(referenceImageUrls);
      let productData = preExtractedProduct || campaign.productData || null;
      if (isDegradedProductData(productData, { requireImages: overrideRefUrls.length === 0 })) {
        const extractRes = await this._withRetry(campaignId, tenantId, currentStage, () =>
          agentClient.extractProduct(campaign.productUrl)
        );
        const extractedProduct = extractRes?.data || extractRes?.product || null;
        if (!extractRes || extractRes.success === false || !extractedProduct) {
          throw new Error(extractRes?.error || 'Product extraction returned no structured product data');
        }
        productData = extractedProduct;
        const extractWarnings = Array.isArray(extractRes.warnings)
          ? extractRes.warnings
          : Array.isArray(extractRes.diagnostics?.warnings)
            ? extractRes.diagnostics.warnings
            : [];
        if (extractWarnings.length > 0) {
          warnings.push(...extractWarnings);
        }
      }

      const refinedName = productData.product_name
        ? `${productData.product_name.slice(0, 64)} — ${formats.join('/')}`
        : campaign.name;

      await CampaignRepository.updateArtifacts(campaignId, tenantId, {
        productData,
        productWarnings: warnings,
        name: refinedName,
      });

      // 2. ANALYZING_PRODUCT -> 3. GENERATING_STRATEGY
      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.ANALYZING_PRODUCT, {
        productName: productData.product_name,
        message: 'Analyzing verified features and customer pain points',
      });
      currentStage = CAMPAIGN_STATUS.ANALYZING_PRODUCT;

      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.GENERATING_STRATEGY, {
        message: 'Synthesizing personas, claims validation, and marketing angles',
      });
      currentStage = CAMPAIGN_STATUS.GENERATING_STRATEGY;

      const refUrls =
        overrideRefUrls.length > 0
          ? overrideRefUrls
          : extractReferenceImageUrls(productData.images);

      let learningHints = null;
      try {
        const mem = await CreativeMemoryService.retrieveLearningMemory(tenantId, {
          productCategory: productData.category || undefined,
          placement: placements[0],
          format: formats[0],
          userPrompt: effectivePrompt,
        });
        if (mem && mem.totalMatchedEntries > 0) {
          learningHints = {
            effective_hooks: (mem.effectiveHooks || []).slice(0, 4),
            avoid_patterns: (mem.failedConcepts || [])
              .flatMap((c) => c.keyLearnings || [])
              .slice(0, 4),
            recommendations: (mem.performanceRecommendations || []).slice(0, 3),
          };
        }
      } catch (memErr) {
        logger.debug(`Creative memory lookup skipped: ${memErr.message}`);
      }

      const strategyRes = await this._withRetry(campaignId, tenantId, currentStage, () =>
        agentClient.generateStrategy({
          product_data: productData,
          user_prompt: effectivePrompt,
          formats,
          placements,
          reference_image_urls: refUrls.length > 0 ? refUrls : null,
          fetch_images: refUrls.length > 0,
          ...(learningHints ? { learning_hints: learningHints } : {}),
        })
      );

      if (!strategyRes?.strategy) {
        throw new Error(strategyRes?.error || 'Marketing strategy generation returned empty strategy');
      }

      const strategy = strategyRes.strategy;
      if (Array.isArray(strategyRes.warnings)) warnings.push(...strategyRes.warnings);

      await CampaignRepository.updateArtifacts(campaignId, tenantId, {
        strategyData: strategy,
      });

      // 4. PLANNING_CREATIVES
      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.PLANNING_CREATIVES, {
        message: 'Planning differentiated image blueprints and video storyboards',
      });
      currentStage = CAMPAIGN_STATUS.PLANNING_CREATIVES;

      const planRes = await this._withRetry(campaignId, tenantId, currentStage, () =>
        agentClient.planCreatives({
          product_data: productData,
          strategy,
          user_prompt: effectivePrompt,
          formats,
          placements,
          target_video_duration: 15,
        })
      );

      if (!planRes?.plan) {
        throw new Error(planRes?.error || 'Creative planning returned no executable blueprints');
      }

      const creativePlan = planRes.plan;
      if (Array.isArray(planRes.warnings)) warnings.push(...planRes.warnings);

      await CampaignRepository.updateArtifacts(campaignId, tenantId, {
        planData: creativePlan,
      });

      // 5. GENERATING_ASSETS
      const concepts = Array.isArray(creativePlan.concepts) ? creativePlan.concepts : [];
      const imageConcepts = formats.includes('image')
        ? concepts.filter((c) => c.format === 'image' && c.image_blueprint).slice(0, 3)
        : [];
      const videoConcepts = formats.includes('video')
        ? concepts.filter((c) => c.format === 'video' && c.video_storyboard).slice(0, 1)
        : [];

      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.GENERATING_ASSETS, {
        plannedImageConcepts: imageConcepts.length,
        plannedVideoConcepts: videoConcepts.length,
        message:
          videoConcepts.length > 0
            ? 'Generating image variations and video storyboards'
            : 'Generating multi-angle image creatives (image-only mode)',
      });
      currentStage = CAMPAIGN_STATUS.GENERATING_ASSETS;

      const generatedRecords = [];
      const approvedImageUrls = [];
      const imageFailureReasons = [];
      const primaryStrategyCta =
        strategy.recommendations?.primary_cta || strategy.cta_recommendations?.[0] || 'Shop Now';

      // 5a. Image Generation
      for (const concept of imageConcepts) {
        const bp = concept.image_blueprint;
        try {
          const resolvedHeadline = bp.hook ? String(bp.hook).slice(0, 120) : undefined;
          const resolvedCta = String(primaryStrategyCta).slice(0, 60);
          const imgRes = await this._withRetry(campaignId, tenantId, currentStage, () =>
            agentClient.generateImages({
              campaign_id: campaignId,
              blueprint: bp,
              marketing_strategy: strategy,
              product_data: productData,
              aspect_ratio: bp.aspect_ratio || '1:1',
              num_variations: 2,
              apply_deterministic_overlay: true,
              overlay_headline: resolvedHeadline,
              overlay_cta: resolvedCta,
              reference_image_urls: refUrls.length > 0 ? refUrls : null,
            })
          );

          totalCostUsd += Number(imgRes?.total_estimated_cost_usd || 0);
          if (Array.isArray(imgRes?.warnings)) warnings.push(...imgRes.warnings);

          for (const asset of imgRes?.assets || []) {
            if (asset.approved && asset.presigned_url) {
              approvedImageUrls.push(asset.presigned_url);
            }
            const created = await CreativeRepository.createCreative({
              tenantId,
              campaignId,
              conceptKey: concept.concept_id,
              creativeKey: asset.creative_id,
              title: bp.creative_title || concept.creative_title || 'Image Creative',
              assetType: 'image',
              placement: bp.placement || concept.placement || placements[0],
              aspectRatio: asset.aspect_ratio || bp.aspect_ratio || '1:1',
              storageKey: asset.overlay_object_key || asset.object_key,
              bucket: asset.metadata?.bucket || 'adpilot-creatives',
              presignedUrl: asset.overlay_presigned_url || asset.presigned_url || null,
              format: asset.mime_type === 'image/jpeg' ? 'jpg' : 'png',
              dimensions: {
                width: asset.width || 1080,
                height: asset.height || 1080,
              },
              marketingAngle: bp.marketing_angle_name || concept.marketing_angle_name || '',
              audienceHypothesis: bp.audience_hypothesis || concept.audience_hypothesis || '',
              hook: bp.hook || '',
              mainMessage: bp.main_message || '',
              visualComposition: bp.visual_composition || '',
              backgroundDirection: bp.background_direction || '',
              creativeInstructions: '',
              promptUsed:
                asset.prompt_used ||
                (typeof bp.image_generation_prompt === 'object'
                  ? bp.image_generation_prompt?.positive_prompt
                  : bp.image_generation_prompt) ||
                '',
              overlaySpec: {
                headline: asset.text_overlay_spec?.headline || bp.hook || '',
                subheadline: asset.text_overlay_spec?.subheadline || bp.main_message || '',
                cta: asset.text_overlay_spec?.cta || primaryStrategyCta,
              },
              blueprint: bp,
              approved: Boolean(asset.approved),
              approvalStatus: asset.approved ? 'approved' : 'needs_review',
              status: asset.approved ? 'approved' : 'ready',
              generationCostUsd: Number(asset.cost?.estimated_cost_usd || 0),
              metadata: {
                modelIdentifier: imgRes.model_identifier,
                promptVersion: imgRes.prompt_version,
                baseObjectKey: asset.object_key,
                validation: asset.validation,
              },
            });
            generatedRecords.push({ record: created, blueprint: bp, storyboard: null, format: 'image' });
            campaignEvents.emitCreativeGenerated(campaignId, created);
          }
        } catch (imgErr) {
          imageFailureReasons.push(`${concept.concept_id}: ${imgErr.message}`);
          warnings.push(`Image generation warning (${concept.concept_id}): ${imgErr.message}`);
        }
      }

      // 5b. Video Generation (async polling)
      const videoFailureReasons = [];
      let completedVideoCount = 0;

      for (const concept of videoConcepts) {
        const sb = concept.video_storyboard;
        try {
          let job = await this._withRetry(campaignId, tenantId, currentStage, () =>
            agentClient.generateVideo({
              campaign_id: campaignId,
              storyboard: sb,
              product_data: productData,
              reference_image_urls: refUrls.length > 0 ? refUrls : null,
              approved_image_urls: approvedImageUrls.length > 0 ? approvedImageUrls : null,
              execute_sync: false,
            })
          );

          const pollLimit = 40;
          let polls = 0;
          while (job && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status) && polls < pollLimit) {
            await sleep(2500);
            polls += 1;
            job = await agentClient.getVideoJobStatus(job.job_id);
            campaignEvents.emitProgress(campaignId, {
              stage: currentStage,
              status: currentStage,
              progress: STAGE_PROGRESS[currentStage],
              videoJobId: job.job_id,
              videoProgress: job.progress_percent,
            });
          }

          totalCostUsd += Number(job?.total_estimated_cost_usd || 0);
          if (Array.isArray(job?.warnings)) warnings.push(...job.warnings);

          if (job?.final_video?.object_key) {
            const fv = job.final_video;
            const videoValidationPassed = Boolean(fv.validation?.approved ?? fv.validation?.passed);
            const created = await CreativeRepository.createCreative({
              tenantId,
              campaignId,
              conceptKey: concept.concept_id,
              creativeKey: fv.video_id,
              title: sb.creative_title || concept.creative_title || 'Video Creative',
              assetType: 'video',
              placement: sb.placement || concept.placement || 'instagram_reels',
              aspectRatio: fv.aspect_ratio || job.target_aspect_ratio || '9:16',
              storageKey: fv.object_key,
              bucket: fv.bucket || 'adpilot-creatives',
              presignedUrl: fv.presigned_url || null,
              format: 'mp4',
              dimensions: {
                width: fv.width || 1080,
                height: fv.height || 1920,
              },
              fileSizeBytes: fv.file_size_bytes || 0,
              durationSeconds: fv.duration_seconds || sb.total_duration || 15,
              hasAudio: Boolean(fv.has_audio),
              marketingAngle: sb.marketing_angle_name || concept.marketing_angle_name || '',
              audienceHypothesis: sb.audience_hypothesis || concept.audience_hypothesis || '',
              hook: sb.opening_hook || '',
              mainMessage: sb.creative_direction_summary || '',
              visualComposition: sb.creative_direction_summary || '',
              backgroundDirection: sb.scene_sequence?.[0]?.background_direction || '',
              creativeInstructions: '',
              promptUsed:
                (typeof sb.video_generation_prompt === 'object'
                  ? sb.video_generation_prompt?.positive_prompt
                  : sb.video_generation_prompt) ||
                sb.scene_sequence?.map((s) => s.scene_description || s.visual_description).filter(Boolean).join(' -> ') ||
                '',
              overlaySpec: {
                headline: sb.opening_hook || '',
                subheadline: '',
                cta: sb.final_cta || primaryStrategyCta,
              },
              blueprint: sb,
              approved: videoValidationPassed,
              approvalStatus: videoValidationPassed ? 'approved' : 'needs_review',
              status: videoValidationPassed ? 'approved' : 'ready',
              generationCostUsd: Number(job.total_estimated_cost_usd || 0),
              metadata: {
                videoJobId: job.job_id,
                subtitlesRendered: fv.subtitles_rendered,
                ctaOverlayApplied: fv.cta_overlay_applied,
                validation: fv.validation,
              },
            });
            generatedRecords.push({ record: created, blueprint: null, storyboard: sb, format: 'video' });
            campaignEvents.emitCreativeGenerated(campaignId, created);

            if (job.status === 'COMPLETED') {
              completedVideoCount += 1;
            } else {
              const reason = job?.errors?.join('; ') || `Video job ended with status ${job?.status}`;
              videoFailureReasons.push(`${concept.concept_id}: ${reason}`);
              warnings.push(`Video assembly note: ${reason}`);
            }
          } else if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(job?.status)) {
            const timeoutMsg = `Video job '${job?.job_id || 'unknown'}' timed out after ${polls} polls (status=${job?.status || 'UNKNOWN'})`;
            videoFailureReasons.push(`${concept.concept_id}: ${timeoutMsg}`);
            warnings.push(timeoutMsg);
          } else {
            const failMsg = job?.errors?.length ? job.errors.join('; ') : `Video generation failed with status ${job?.status || 'UNKNOWN'}`;
            videoFailureReasons.push(`${concept.concept_id}: ${failMsg}`);
            warnings.push(`Video assembly note: ${failMsg}`);
          }
        } catch (vidErr) {
          videoFailureReasons.push(`${concept.concept_id}: ${vidErr.message}`);
          warnings.push(`Video generation warning (${concept.concept_id}): ${vidErr.message}`);
        }
      }

      if (generatedRecords.length === 0) {
        const failureReasons = Array.from(new Set([...imageFailureReasons, ...videoFailureReasons]));
        const reasonSuffix = failureReasons.length > 0 ? `: ${failureReasons.join(' | ')}` : '';
        throw new Error(`No creative assets could be generated for this campaign${reasonSuffix}`);
      }

      if (videoConcepts.length > 0 && (videoFailureReasons.length > 0 || completedVideoCount === 0)) {
        throw new Error(
          `Requested video creative generation did not complete cleanly: ${videoFailureReasons.join(' | ')}`
        );
      }

      // 6. EVALUATING_CREATIVES
      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.EVALUATING_CREATIVES, {
        creativeCount: generatedRecords.length,
        message: 'Running 10-criterion multimodal quality assurance',
      });
      currentStage = CAMPAIGN_STATUS.EVALUATING_CREATIVES;

      for (const item of generatedRecords) {
        const cr = item.record;
        try {
          const evalRes = await agentClient.evaluateCreative({
            campaign_id: campaignId,
            creative_id: cr.creativeKey || cr.id,
            format: item.format,
            product_data: productData,
            marketing_strategy: strategy,
            image_blueprint: item.blueprint,
            video_storyboard: item.storyboard,
            placement_spec: derivePlacementSpec(creativePlan, cr.placement),
            object_key: cr.storageKey,
            creative_url: cr.presignedUrl || undefined,
            reference_image_urls: refUrls.length > 0 ? refUrls : null,
          });

          const isApproved = Boolean(evalRes?.approved);
          await CreativeRepository.updateCreative(cr.id, tenantId, {
            evaluation: evalRes,
            approved: isApproved,
            approvalStatus: isApproved ? 'approved' : 'rejected',
            status: isApproved ? 'approved' : 'ready',
          });
          item.evaluation = evalRes;
          cr.approved = isApproved;
        } catch (evalErr) {
          warnings.push(`Evaluation note (${cr.title}): ${evalErr.message}`);
        }
      }

      // 7. GENERATING_COPY
      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.GENERATING_COPY, {
        message: 'Generating claim-verified ad headlines, primary copy, and CTAs',
      });
      currentStage = CAMPAIGN_STATUS.GENERATING_COPY;

      for (const item of generatedRecords) {
        const cr = item.record;
        if (!item.evaluation?.approved) {
          await CreativeRepository.createAdCopy({
            tenantId,
            campaignId,
            creativeId: cr.id,
            headline: cr.hook || productData.product_name || 'Product Spotlight',
            headlines: [cr.hook || productData.product_name || 'Product Spotlight'],
            primaryText:
              cr.mainMessage || productData.description || `${productData.product_name} built for everyday reliability.`,
            primaryTexts: [
              cr.mainMessage || productData.description || `${productData.product_name} built for everyday reliability.`,
            ],
            description: cr.marketingAngle || '',
            descriptions: cr.marketingAngle ? [cr.marketingAngle] : [],
            callToAction: cr.overlaySpec?.cta || primaryStrategyCta,
            platform: cr.placement,
            placement: cr.placement,
            creativeAngle: cr.marketingAngle || '',
            audienceHypothesis: cr.audienceHypothesis || '',
            supportingEvidence: [],
          });
          continue;
        }
        try {
          const copyRes = await agentClient.generateAdCopy({
            campaign_id: campaignId,
            creative_id: cr.creativeKey || cr.id,
            creative_evaluation: item.evaluation,
            product_data: productData,
            marketing_strategy: strategy,
            image_blueprint: item.blueprint,
            video_storyboard: item.storyboard,
          });

          if (copyRes) {
            const headlines = (copyRes.headlines || []).map((h) => h.text);
            const primaryTexts = (copyRes.primary_texts || []).map((p) => p.text);
            const descriptions = (copyRes.descriptions || []).map((d) => d.text);
            const evidence = [
              ...(copyRes.headlines || []),
              ...(copyRes.primary_texts || []),
            ]
              .flatMap((v) => v.linked_claims || [])
              .map((lc) => `${lc.verified_source_field}: ${lc.claim_text}`);

            await CreativeRepository.createAdCopy({
              tenantId,
              campaignId,
              creativeId: cr.id,
              headline: headlines[0] || cr.hook || productData.product_name,
              headlines,
              primaryText: primaryTexts[0] || cr.mainMessage || productData.description || productData.product_name,
              primaryTexts,
              description: descriptions[0] || '',
              descriptions,
              callToAction: copyRes.cta_recommendation || cr.overlaySpec?.cta || 'Shop Now',
              platform: cr.placement,
              placement: cr.placement,
              creativeAngle: copyRes.creative_angle || cr.marketingAngle || '',
              audienceHypothesis: copyRes.audience_hypothesis || cr.audienceHypothesis || '',
              supportingEvidence: Array.from(new Set(evidence)).slice(0, 12),
            });
          }
        } catch (copyErr) {
          warnings.push(`Copy note (${cr.title}): ${copyErr.message}`);
        }
      }

      // 8. ASSEMBLING_CAMPAIGN
      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.ASSEMBLING_CAMPAIGN, {
        message: 'Packaging creatives, verified copy, and audience insights',
      });
      currentStage = CAMPAIGN_STATUS.ASSEMBLING_CAMPAIGN;

      await CampaignRepository.updateArtifacts(campaignId, tenantId, {
        executionMetadata: {
          durationMs: Date.now() - startedAt,
          totalCostUsd: Number(totalCostUsd.toFixed(4)),
          generatedCount: generatedRecords.length,
          approvedCount: generatedRecords.filter((g) => g.record.approved).length,
          warnings,
          completedAt: new Date().toISOString(),
        },
      });

      // 9. COMPLETED
      const roundedCostUsd = Number(totalCostUsd.toFixed(4));
      metricsService.recordCampaignOutcome({ succeeded: true, costUsd: roundedCostUsd });

      await this._transitionStage(campaignId, tenantId, currentStage, CAMPAIGN_STATUS.COMPLETED, {
        durationMs: Date.now() - startedAt,
        totalCostUsd: roundedCostUsd,
      });
      campaignEvents.emitCompleted(campaignId, {
        durationMs: Date.now() - startedAt,
        generatedCount: generatedRecords.length,
        warnings,
      });

      return await CampaignRepository.findById(campaignId, tenantId);
    } catch (err) {
      metricsService.recordCampaignOutcome({ succeeded: false, costUsd: totalCostUsd });
      metricsService.reportError(err, { campaignId, stage: currentStage });
      logger.error(`Campaign ${campaignId} failed at ${currentStage}: ${err.message}`);
      await CampaignRepository.recordError(campaignId, tenantId, {
        errorCode: err.errorCode || 'CAMPAIGN_EXECUTION_ERROR',
        errorMessage: err.message,
        failedStage: currentStage,
        details: {
          warnings,
          durationMs: Date.now() - startedAt,
        },
      });
      campaignEvents.emitFailure(campaignId, currentStage, err.message, { warnings });
      throw err;
    }
  }

  /**
   * Detect stalled non-terminal campaigns left behind by worker crashes/restarts.
   * Preserves completed intermediate artifacts & creatives without data corruption,
   * and either requeues recoverable runs (up to maxRecoveryAttempts) or marks
   * permanently stalled runs cleanly.
   */
  async recoverStalledCampaigns({
    staleThresholdMs = 5 * 60 * 1000,
    tenantId = null,
    autoRequeue = false,
    maxRecoveryAttempts = 2,
    nowMs = Date.now(),
  } = {}) {
    const candidates = await CampaignRepository.findStalledCampaigns({
      staleThresholdMs,
      tenantId,
      nowMs,
    });

    const recovered = [];
    for (const camp of candidates) {
      const cid = String(camp.id || camp._id);
      if (this.activeRuns.has(cid)) continue;

      const priorRetries = Number(camp.retryCount || 0);
      const canRequeue = autoRequeue && priorRetries < maxRecoveryAttempts;

      if (canRequeue) {
        await CampaignRepository.updateArtifacts(cid, camp.tenantId, {
          retryCount: priorRetries + 1,
          status: CAMPAIGN_STATUS.QUEUED,
          currentStage: CAMPAIGN_STATUS.QUEUED,
          errorMetadata: {
            errorCode: 'WORKER_CRASH_REQUEUED',
            errorMessage: `Recovered stalled job from stage ${camp.currentStage}`,
            failedStage: camp.currentStage,
            recoveredAt: new Date(nowMs).toISOString(),
          },
        });
        this.scheduleCampaign(cid, camp.tenantId, { force: true, delayMs: 25 });
        recovered.push({ campaignId: cid, action: 'requeued', previousStage: camp.currentStage });
      } else {
        await CampaignRepository.recordError(cid, camp.tenantId, {
          errorCode: 'WORKER_STALL_RECOVERED',
          errorMessage: `Worker process stopped during ${camp.currentStage}. Partial artifacts preserved; click Regenerate to resume safely.`,
          failedStage: camp.currentStage,
          details: { recoveredAt: new Date(nowMs).toISOString(), preservedProductData: Boolean(camp.productData) },
        });
        recovered.push({ campaignId: cid, action: 'marked_recoverable_failure', previousStage: camp.currentStage });
      }
    }

    if (recovered.length > 0) {
      metricsService.recordWorkerRecovery(recovered.length);
      logger.warn(`Recovered ${recovered.length} stalled campaign(s)`, { recovered });
    }

    return {
      scannedCount: candidates.length,
      recoveredCount: recovered.length,
      recovered,
    };
  }
}

export const campaignOrchestrator = new OrchestratorEngine();
