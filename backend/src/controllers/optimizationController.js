import { PerformanceAnalyzerService } from '../services/performanceAnalyzerService.js';
import { CreativeMemoryService } from '../services/creativeMemoryService.js';
import { ExperimentService } from '../services/experimentService.js';
import { OptimizationRepository } from '../repositories/optimizationRepository.js';
import { campaignOrchestrator } from '../services/campaignOrchestrator.js';
import { NotFoundError } from '../utils/errors.js';

export async function getPerformanceIntelligence(req, res, next) {
  try {
    const analysis = await PerformanceAnalyzerService.analyzePerformance(req.tenantId, req.query);
    return res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (err) {
    next(err);
  }
}

export async function listRecommendations(req, res, next) {
  try {
    const items = await OptimizationRepository.listInsights(req.tenantId, req.query);
    return res.status(200).json({
      success: true,
      data: {
        items,
        count: items.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function generateRecommendations(req, res, next) {
  try {
    const result = await ExperimentService.generateRecommendations(req.tenantId, req.body || {});
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateRecommendationStatus(req, res, next) {
  try {
    const updated = await OptimizationRepository.updateInsightStatus(
      req.params.id,
      req.tenantId,
      req.body.actionStatus
    );
    if (!updated) {
      throw new NotFoundError('Optimization recommendation not found');
    }
    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function retrieveLearningMemory(req, res, next) {
  try {
    const memory = await CreativeMemoryService.retrieveLearningMemory(req.tenantId, req.query);
    return res.status(200).json({
      success: true,
      data: memory,
    });
  } catch (err) {
    next(err);
  }
}

export async function syncLearningMemory(req, res, next) {
  try {
    const result = await CreativeMemoryService.syncLearningMemory(req.tenantId, req.body || {});
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function listExperiments(req, res, next) {
  try {
    const items = await OptimizationRepository.listExperiments(req.tenantId, req.query);
    return res.status(200).json({
      success: true,
      data: {
        items,
        count: items.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function createExperiment(req, res, next) {
  try {
    const created = await ExperimentService.createExperiment(req.tenantId, req.body);
    return res.status(201).json({
      success: true,
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

export async function recordExperimentMetrics(req, res, next) {
  try {
    const updated = await ExperimentService.recordVariantMetrics(
      req.tenantId,
      req.params.id,
      req.body
    );
    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function approveExperimentBudget(req, res, next) {
  try {
    const updated = await ExperimentService.approveExperimentBudgetAction(
      req.tenantId,
      req.userId,
      req.params.id,
      req.body
    );
    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function triggerWorkerRecovery(req, res, next) {
  try {
    const result = await campaignOrchestrator.recoverStalledCampaigns({
      tenantId: req.tenantId,
      staleThresholdMs: req.body?.staleThresholdMs ?? 5 * 60 * 1000,
      autoRequeue: Boolean(req.body?.autoRequeue),
    });
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}
