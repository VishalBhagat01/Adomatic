import mongoose from 'mongoose';
import { Campaign, CAMPAIGN_STATUS, STAGE_PROGRESS } from '../models/Campaign.js';

// In-memory fallback store when MongoDB connection is not active (e.g. offline/isolated test runs)
const memoryStore = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

export class CampaignRepository {
  /**
   * Create new campaign record with initialized state.
   */
  static async create(campaignData) {
    if (isMongoConnected()) {
      const campaign = new Campaign({
        ...campaignData,
        status: CAMPAIGN_STATUS.INITIALIZED,
        currentStage: CAMPAIGN_STATUS.INITIALIZED,
        progress: STAGE_PROGRESS[CAMPAIGN_STATUS.INITIALIZED],
        stageHistory: [
          {
            stage: CAMPAIGN_STATUS.INITIALIZED,
            status: 'completed',
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
      });
      return await campaign.save();
    }

    // In-Memory Fallback
    const id = new mongoose.Types.ObjectId().toString();
    const doc = {
      id,
      _id: id,
      ...campaignData,
      status: CAMPAIGN_STATUS.INITIALIZED,
      currentStage: CAMPAIGN_STATUS.INITIALIZED,
      progress: STAGE_PROGRESS[CAMPAIGN_STATUS.INITIALIZED],
      stageHistory: [
        {
          stage: CAMPAIGN_STATUS.INITIALIZED,
          status: 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ],
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryStore.set(id, doc);
    return doc;
  }

  /**
   * Find campaign by ID with tenant scoping.
   */
  static async findById(id, tenantId) {
    if (isMongoConnected()) {
      const query = { _id: id, isDeleted: false };
      if (tenantId) query.tenantId = tenantId;
      return await Campaign.findOne(query);
    }

    const doc = memoryStore.get(String(id));
    if (!doc || doc.isDeleted) return null;
    if (tenantId && doc.tenantId !== tenantId) return null;
    return doc;
  }

  /**
   * Find by idempotency key to prevent duplicate creation.
   */
  static async findByIdempotencyKey(idempotencyKey, tenantId) {
    if (!idempotencyKey) return null;

    if (isMongoConnected()) {
      const query = { idempotencyKey, isDeleted: false };
      if (tenantId) query.tenantId = tenantId;
      return await Campaign.findOne(query);
    }

    for (const doc of memoryStore.values()) {
      if (doc.idempotencyKey === idempotencyKey && !doc.isDeleted) {
        if (!tenantId || doc.tenantId === tenantId) {
          return doc;
        }
      }
    }
    return null;
  }

  /**
   * Paginated list of campaigns for a tenant.
   */
  static async findPaginated({ tenantId, page = 1, limit = 10, status, search }) {
    if (isMongoConnected()) {
      const query = { isDeleted: false };
      if (tenantId) query.tenantId = tenantId;
      if (status) query.status = status;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { userPrompt: { $regex: search, $options: 'i' } },
          { productUrl: { $regex: search, $options: 'i' } },
        ];
      }

      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        Campaign.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Campaign.countDocuments(query),
      ]);

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
      };
    }

    // In-memory filter
    let docs = Array.from(memoryStore.values()).filter((d) => !d.isDeleted);
    if (tenantId) docs = docs.filter((d) => d.tenantId === tenantId);
    if (status) docs = docs.filter((d) => d.status === status);
    if (search) {
      const s = search.toLowerCase();
      docs = docs.filter(
        (d) =>
          (d.name && d.name.toLowerCase().includes(s)) ||
          (d.userPrompt && d.userPrompt.toLowerCase().includes(s)) ||
          (d.productUrl && d.productUrl.toLowerCase().includes(s))
      );
    }

    docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = docs.length;
    const skip = (page - 1) * limit;
    const items = docs.slice(skip, skip + limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Persist extracted product, strategy, creative plan, retry count, or execution metadata.
   */
  static async updateArtifacts(id, tenantId, patch = {}) {
    if (isMongoConnected()) {
      const query = { _id: id, isDeleted: false };
      if (tenantId) query.tenantId = tenantId;
      return await Campaign.findOneAndUpdate(
        query,
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      );
    }

    const doc = await this.findById(id, tenantId);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: new Date() });
    return doc;
  }

  /**
   * Aggregate real campaign summary metrics, status distribution, and recent stage activity.
   */
  static async getDashboardStats(tenantId, recentLimit = 5) {
    let allCampaigns = [];

    if (isMongoConnected()) {
      const query = { isDeleted: false };
      if (tenantId) query.tenantId = tenantId;
      allCampaigns = await Campaign.find(query).sort({ createdAt: -1 }).limit(200);
    } else {
      allCampaigns = Array.from(memoryStore.values())
        .filter((d) => !d.isDeleted && (!tenantId || d.tenantId === tenantId))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const statusCounts = {};
    const activityEvents = [];

    for (const c of allCampaigns) {
      const status = c.status || 'INITIALIZED';
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const history = Array.isArray(c.stageHistory) ? c.stageHistory : [];
      for (const entry of history) {
        activityEvents.push({
          campaignId: c.id || String(c._id),
          campaignName: c.name || 'Untitled Campaign',
          stage: entry.stage,
          status: entry.status,
          timestamp: entry.completedAt || entry.startedAt || c.updatedAt || c.createdAt,
          error: entry.error || null,
          metadata: entry.metadata || {},
        });
      }
    }

    activityEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return {
      totalCampaigns: allCampaigns.length,
      statusCounts,
      recentCampaigns: allCampaigns.slice(0, recentLimit),
      recentActivity: activityEvents.slice(0, 15),
    };
  }

  /**
   * Atomically transition campaign to a new lifecycle stage.
   */
  static async updateStage(id, tenantId, newStage, metadata = {}) {
    const progress = STAGE_PROGRESS[newStage] ?? 0;

    if (isMongoConnected()) {
      const updateDoc = {
        $set: {
          status: newStage,
          currentStage: newStage,
          progress,
          updatedAt: new Date(),
        },
        $push: {
          stageHistory: {
            stage: newStage,
            status: newStage === CAMPAIGN_STATUS.COMPLETED ? 'completed' : 'started',
            startedAt: new Date(),
            metadata,
          },
        },
      };

      const query = { _id: id, isDeleted: false };
      if (tenantId) query.tenantId = tenantId;

      return await Campaign.findOneAndUpdate(query, updateDoc, { new: true });
    }

    const doc = await this.findById(id, tenantId);
    if (!doc) return null;

    doc.status = newStage;
    doc.currentStage = newStage;
    doc.progress = progress;
    doc.updatedAt = new Date();
    doc.stageHistory.push({
      stage: newStage,
      status: newStage === CAMPAIGN_STATUS.COMPLETED ? 'completed' : 'started',
      startedAt: new Date().toISOString(),
      metadata,
    });
    return doc;
  }

  /**
   * Mark stage as failed with structured error metadata.
   */
  static async recordError(id, tenantId, { errorCode, errorMessage, failedStage, details = {} }) {
    if (isMongoConnected()) {
      const updateDoc = {
        $set: {
          status: CAMPAIGN_STATUS.FAILED,
          currentStage: failedStage || 'UNKNOWN',
          errorMetadata: {
            errorCode,
            errorMessage,
            failedStage,
            failedAt: new Date(),
            details,
          },
          updatedAt: new Date(),
        },
        $push: {
          stageHistory: {
            stage: failedStage || 'UNKNOWN',
            status: 'failed',
            startedAt: new Date(),
            completedAt: new Date(),
            error: errorMessage,
          },
        },
      };

      const query = { _id: id };
      if (tenantId) query.tenantId = tenantId;

      return await Campaign.findOneAndUpdate(query, updateDoc, { new: true });
    }

    const doc = await this.findById(id, tenantId);
    if (!doc) return null;

    doc.status = CAMPAIGN_STATUS.FAILED;
    doc.currentStage = failedStage || 'UNKNOWN';
    doc.errorMetadata = {
      errorCode,
      errorMessage,
      failedStage,
      failedAt: new Date().toISOString(),
      details,
    };
    doc.updatedAt = new Date();
    doc.stageHistory.push({
      stage: failedStage || 'UNKNOWN',
      status: 'failed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: errorMessage,
    });
    return doc;
  }

  /**
   * Update queue Job ID.
   */
  static async updateJobId(id, jobId) {
    if (isMongoConnected()) {
      return await Campaign.findByIdAndUpdate(id, { $set: { jobId } }, { new: true });
    }
    const doc = memoryStore.get(String(id));
    if (doc) doc.jobId = jobId;
    return doc;
  }

  /**
   * Soft delete a campaign.
   */
  static async softDelete(id, tenantId) {
    if (isMongoConnected()) {
      const query = { _id: id, isDeleted: false };
      if (tenantId) query.tenantId = tenantId;

      return await Campaign.findOneAndUpdate(
        query,
        { $set: { isDeleted: true, deletedAt: new Date() } },
        { new: true }
      );
    }

    const doc = await this.findById(id, tenantId);
    if (!doc) return null;
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    return doc;
  }

  /**
   * Reset campaign state for regeneration.
   */
  static async resetForRegeneration(id, tenantId) {
    if (isMongoConnected()) {
      const query = { _id: id, isDeleted: false };
      if (tenantId) query.tenantId = tenantId;

      return await Campaign.findOneAndUpdate(
        query,
        {
          $set: {
            status: CAMPAIGN_STATUS.QUEUED,
            currentStage: CAMPAIGN_STATUS.QUEUED,
            progress: STAGE_PROGRESS[CAMPAIGN_STATUS.QUEUED],
            errorMetadata: null,
            updatedAt: new Date(),
          },
          $push: {
            stageHistory: {
              stage: 'REGENERATION_REQUESTED',
              status: 'started',
              startedAt: new Date(),
            },
          },
        },
        { new: true }
      );
    }

    const doc = await this.findById(id, tenantId);
    if (!doc) return null;

    doc.status = CAMPAIGN_STATUS.QUEUED;
    doc.currentStage = CAMPAIGN_STATUS.QUEUED;
    doc.progress = STAGE_PROGRESS[CAMPAIGN_STATUS.QUEUED];
    doc.errorMetadata = null;
    doc.updatedAt = new Date();
    doc.stageHistory.push({
      stage: 'REGENERATION_REQUESTED',
      status: 'started',
      startedAt: new Date().toISOString(),
    });
    return doc;
  }

  /**
   * Find active non-terminal campaigns whose updatedAt timestamp indicates a stalled worker run.
   */
  static async findStalledCampaigns({
    staleThresholdMs = 5 * 60 * 1000,
    tenantId = null,
    nowMs = Date.now(),
  } = {}) {
    const cutoff = new Date(nowMs - staleThresholdMs);
    const activeStages = [
      CAMPAIGN_STATUS.QUEUED,
      CAMPAIGN_STATUS.EXTRACTING_PRODUCT,
      CAMPAIGN_STATUS.ANALYZING_PRODUCT,
      CAMPAIGN_STATUS.GENERATING_STRATEGY,
      CAMPAIGN_STATUS.PLANNING_CREATIVES,
      CAMPAIGN_STATUS.GENERATING_ASSETS,
      CAMPAIGN_STATUS.EVALUATING_CREATIVES,
      CAMPAIGN_STATUS.ASSEMBLING_CAMPAIGN,
    ];

    if (isMongoConnected()) {
      const query = {
        isDeleted: false,
        status: { $in: activeStages },
        updatedAt: { $lte: cutoff },
      };
      if (tenantId) query.tenantId = tenantId;
      return await Campaign.find(query).limit(100);
    }

    return Array.from(memoryStore.values()).filter((doc) => {
      if (doc.isDeleted) return false;
      if (tenantId && doc.tenantId !== tenantId) return false;
      if (!activeStages.includes(doc.status)) return false;
      const updatedMs = new Date(doc.updatedAt || doc.createdAt).getTime();
      return updatedMs <= cutoff.getTime();
    });
  }

  static clearMemoryStore() {
    memoryStore.clear();
  }
}
