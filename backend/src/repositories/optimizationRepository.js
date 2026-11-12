import mongoose from 'mongoose';
import { OptimizationInsight } from '../models/OptimizationInsight.js';
import { CreativeExperiment } from '../models/CreativeExperiment.js';
import { CreativeMemoryEntry } from '../models/CreativeMemoryEntry.js';

const insightMemoryStore = new Map();
const experimentMemoryStore = new Map();
const memoryEntryStore = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.toString) return value.toString();
  return String(value);
}

function toPlain(doc) {
  if (!doc) return null;
  if (typeof doc.toJSON === 'function') return doc.toJSON();
  const clone = { ...doc };
  if (!clone.id && clone._id) clone.id = normalizeId(clone._id);
  return clone;
}

export class OptimizationRepository {
  // === INSIGHTS / RECOMMENDATIONS ===

  static async createInsight(data) {
    if (isMongoConnected()) {
      const doc = new OptimizationInsight(data);
      return toPlain(await doc.save());
    }

    const id = new mongoose.Types.ObjectId().toString();
    const now = new Date();
    const doc = {
      id,
      _id: id,
      actionStatus: 'pending',
      impactLevel: 'medium',
      confidenceScore: 0.5,
      observedEvidence: {},
      sampleSizeWarning: null,
      correlationVsCausationNote: null,
      ...data,
      campaignId: normalizeId(data.campaignId),
      creativeId: normalizeId(data.creativeId),
      experimentId: normalizeId(data.experimentId),
      createdAt: now,
      updatedAt: now,
    };
    insightMemoryStore.set(id, doc);
    return toPlain(doc);
  }

  static async upsertInsightsForTenant(tenantId, items = []) {
    const saved = [];
    for (const item of items) {
      const created = await this.createInsight({ ...item, tenantId });
      saved.push(created);
    }
    return saved;
  }

  static async listInsights(tenantId, filters = {}) {
    if (isMongoConnected()) {
      const query = { tenantId };
      if (filters.campaignId) query.campaignId = filters.campaignId;
      if (filters.actionStatus) query.actionStatus = filters.actionStatus;
      if (filters.insightType) query.insightType = filters.insightType;
      const docs = await OptimizationInsight.find(query).sort({ createdAt: -1 }).limit(100);
      return docs.map(toPlain);
    }

    return Array.from(insightMemoryStore.values())
      .filter((d) => {
        if (tenantId && d.tenantId !== tenantId) return false;
        if (filters.campaignId && normalizeId(d.campaignId) !== normalizeId(filters.campaignId)) return false;
        if (filters.actionStatus && d.actionStatus !== filters.actionStatus) return false;
        if (filters.insightType && d.insightType !== filters.insightType) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100)
      .map(toPlain);
  }

  static async updateInsightStatus(id, tenantId, actionStatus) {
    if (isMongoConnected()) {
      const updated = await OptimizationInsight.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { actionStatus, updatedAt: new Date() } },
        { new: true }
      );
      return toPlain(updated);
    }

    const doc = insightMemoryStore.get(String(id));
    if (!doc || (tenantId && doc.tenantId !== tenantId)) return null;
    doc.actionStatus = actionStatus;
    doc.updatedAt = new Date();
    return toPlain(doc);
  }

  // === CONTROLLED EXPERIMENTS ===

  static async createExperiment(data) {
    if (isMongoConnected()) {
      const doc = new CreativeExperiment(data);
      return toPlain(await doc.save());
    }

    const id = new mongoose.Types.ObjectId().toString();
    const now = new Date();
    const doc = {
      id,
      _id: id,
      status: 'running',
      minSampleImpressions: 1000,
      minSampleClicks: 30,
      confidenceLevel: 0,
      pValue: 1,
      winningVariantId: null,
      conclusion: '',
      sampleSizeWarnings: [],
      correlationVsCausationNote: '',
      banditEnabled: false,
      banditEligible: false,
      banditAllocations: {},
      requiresExplicitUserApproval: true,
      userApprovedBudgetAction: false,
      approvedBy: null,
      approvedAt: null,
      startDate: now,
      endDate: null,
      ...data,
      campaignId: normalizeId(data.campaignId),
      createdAt: now,
      updatedAt: now,
    };
    experimentMemoryStore.set(id, doc);
    return toPlain(doc);
  }

  static async getExperimentById(id, tenantId) {
    if (isMongoConnected()) {
      const query = { _id: id };
      if (tenantId) query.tenantId = tenantId;
      return toPlain(await CreativeExperiment.findOne(query));
    }

    const doc = experimentMemoryStore.get(String(id));
    if (!doc || (tenantId && doc.tenantId !== tenantId)) return null;
    return toPlain(doc);
  }

  static async listExperiments(tenantId, filters = {}) {
    if (isMongoConnected()) {
      const query = { tenantId };
      if (filters.status) query.status = filters.status;
      if (filters.campaignId) query.campaignId = filters.campaignId;
      const docs = await CreativeExperiment.find(query).sort({ createdAt: -1 }).limit(100);
      return docs.map(toPlain);
    }

    return Array.from(experimentMemoryStore.values())
      .filter((d) => {
        if (tenantId && d.tenantId !== tenantId) return false;
        if (filters.status && d.status !== filters.status) return false;
        if (filters.campaignId && normalizeId(d.campaignId) !== normalizeId(filters.campaignId)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100)
      .map(toPlain);
  }

  static async updateExperiment(id, tenantId, patch = {}) {
    if (isMongoConnected()) {
      const updated = await CreativeExperiment.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      );
      return toPlain(updated);
    }

    const doc = experimentMemoryStore.get(String(id));
    if (!doc || (tenantId && doc.tenantId !== tenantId)) return null;
    Object.assign(doc, patch, { updatedAt: new Date() });
    return toPlain(doc);
  }

  // === CREATIVE LEARNING MEMORY ===

  static async upsertMemoryEntry(data) {
    const keySourceCreativeId = normalizeId(data.sourceCreativeId);
    if (isMongoConnected()) {
      if (keySourceCreativeId) {
        const updated = await CreativeMemoryEntry.findOneAndUpdate(
          { tenantId: data.tenantId, sourceCreativeId: keySourceCreativeId },
          { $set: { ...data, updatedAt: new Date() } },
          { upsert: true, new: true }
        );
        return toPlain(updated);
      }
      const created = new CreativeMemoryEntry(data);
      return toPlain(await created.save());
    }

    if (keySourceCreativeId) {
      for (const existing of memoryEntryStore.values()) {
        if (
          existing.tenantId === data.tenantId &&
          normalizeId(existing.sourceCreativeId) === keySourceCreativeId
        ) {
          Object.assign(existing, data, { updatedAt: new Date() });
          return toPlain(existing);
        }
      }
    }

    const id = new mongoose.Types.ObjectId().toString();
    const now = new Date();
    const doc = {
      id,
      _id: id,
      neverOverrideVerifiedProduct: true,
      keyLearnings: [],
      tokenVector: {},
      metricsSummary: {},
      ...data,
      sourceCampaignId: normalizeId(data.sourceCampaignId),
      sourceCreativeId: keySourceCreativeId,
      createdAt: now,
      updatedAt: now,
    };
    memoryEntryStore.set(id, doc);
    return toPlain(doc);
  }

  static async queryMemoryEntries(tenantId, filters = {}) {
    if (isMongoConnected()) {
      const query = { tenantId };
      if (filters.productCategory) query.productCategory = filters.productCategory;
      if (filters.placement) query.placement = filters.placement;
      if (filters.format) query.format = filters.format;
      if (filters.marketingAngle) query.marketingAngle = filters.marketingAngle;
      if (filters.hookType) query.hookType = filters.hookType;
      if (filters.outcomeStatus) query.outcomeStatus = filters.outcomeStatus;
      const docs = await CreativeMemoryEntry.find(query).sort({ updatedAt: -1 }).limit(200);
      return docs.map(toPlain);
    }

    return Array.from(memoryEntryStore.values())
      .filter((d) => {
        if (tenantId && d.tenantId !== tenantId) return false;
        if (filters.productCategory && d.productCategory !== filters.productCategory) return false;
        if (filters.placement && d.placement !== filters.placement) return false;
        if (filters.format && d.format !== filters.format) return false;
        if (filters.marketingAngle && d.marketingAngle !== filters.marketingAngle) return false;
        if (filters.hookType && d.hookType !== filters.hookType) return false;
        if (filters.outcomeStatus && d.outcomeStatus !== filters.outcomeStatus) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 200)
      .map(toPlain);
  }

  static clearMemoryStore() {
    insightMemoryStore.clear();
    experimentMemoryStore.clear();
    memoryEntryStore.clear();
  }
}

