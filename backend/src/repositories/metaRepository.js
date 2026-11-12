import mongoose from 'mongoose';
import {
  MetaConnection,
  MetaCreativeMapping,
  MetaInsightSnapshot,
  MetaSyncRun,
  CampaignPerformance,
} from '../models/index.js';

const connectionMemoryStore = new Map();
const mappingMemoryStore = new Map(); // key: `${tenantId}:${metaAdAccountId}:${metaAdId}`
const insightMemoryStore = new Map(); // key: `${tenantId}:${syncKey}`
const syncRunMemoryStore = new Map();
const campaignPerfMemoryStore = new Map();

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

function normalizeId(val) {
  if (!val) return null;
  return typeof val === 'string' ? val : String(val);
}

function newId() {
  return new mongoose.Types.ObjectId().toString();
}

export function sanitizeConnection(doc) {
  if (!doc) return null;
  const plain = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  delete plain.encryptedToken;
  return {
    ...plain,
    id: plain.id || normalizeId(plain._id),
  };
}

export class MetaRepository {
  // ---------------------------------------------------------------------------
  // Connections & Encrypted Tokens
  // ---------------------------------------------------------------------------
  static async saveConnection(data) {
    if (isMongoConnected()) {
      await MetaConnection.updateMany(
        { tenantId: data.tenantId, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked', updatedAt: new Date() } }
      );
      const created = new MetaConnection(data);
      const saved = await created.save();
      return sanitizeConnection(saved);
    }

    for (const existing of connectionMemoryStore.values()) {
      if (existing.tenantId === data.tenantId && existing.status !== 'revoked') {
        existing.status = 'revoked';
        existing.updatedAt = new Date();
      }
    }

    const id = newId();
    const doc = {
      id,
      _id: id,
      ...data,
      status: data.status || 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    connectionMemoryStore.set(id, doc);
    return sanitizeConnection(doc);
  }

  static async getActiveConnection(tenantId, { includeEncryptedToken = false } = {}) {
    if (isMongoConnected()) {
      const q = MetaConnection.findOne({
        tenantId,
        status: { $in: ['active', 'expiring_soon', 'expired'] },
      }).sort({ createdAt: -1 });
      if (includeEncryptedToken) {
        q.select('+encryptedToken');
      }
      const doc = await q.exec();
      if (!doc) return null;
      if (includeEncryptedToken) {
        const obj = doc.toObject();
        obj.id = doc._id.toString();
        return obj;
      }
      return sanitizeConnection(doc);
    }

    const matches = Array.from(connectionMemoryStore.values())
      .filter((c) => c.tenantId === tenantId && c.status !== 'revoked')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const found = matches[0] || null;
    if (!found) return null;
    return includeEncryptedToken ? { ...found } : sanitizeConnection(found);
  }

  static async updateConnection(id, tenantId, patch) {
    if (isMongoConnected()) {
      const updated = await MetaConnection.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      );
      return sanitizeConnection(updated);
    }

    const doc = connectionMemoryStore.get(normalizeId(id));
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, patch, { updatedAt: new Date() });
    return sanitizeConnection(doc);
  }

  static async revokeConnections(tenantId) {
    if (isMongoConnected()) {
      await MetaConnection.updateMany(
        { tenantId, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked', writeAuthorized: false, updatedAt: new Date() } }
      );
      return;
    }
    for (const doc of connectionMemoryStore.values()) {
      if (doc.tenantId === tenantId && doc.status !== 'revoked') {
        doc.status = 'revoked';
        doc.writeAuthorized = false;
        doc.updatedAt = new Date();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // AdPilot <-> Meta Ad Mappings (Campaign -> Creative -> Meta Ad)
  // ---------------------------------------------------------------------------
  static async upsertCreativeMapping(tenantId, payload) {
    const cleanAccount = payload.metaAdAccountId.startsWith('act_')
      ? payload.metaAdAccountId
      : `act_${payload.metaAdAccountId}`;
    const docPatch = {
      ...payload,
      tenantId,
      metaAdAccountId: cleanAccount,
      adPilotCampaignId: payload.adPilotCampaignId || null,
      adPilotCreativeId: payload.adPilotCreativeId || null,
      updatedAt: new Date(),
    };

    const propagatePatch = {
      adPilotCampaignId: docPatch.adPilotCampaignId,
      adPilotCreativeId: docPatch.adPilotCreativeId,
      ...(docPatch.origin ? { origin: docPatch.origin } : {}),
    };

    if (isMongoConnected()) {
      const [saved] = await Promise.all([
        MetaCreativeMapping.findOneAndUpdate(
          { tenantId, metaAdAccountId: cleanAccount, metaAdId: payload.metaAdId },
          { $set: docPatch, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, new: true }
        ),
        MetaInsightSnapshot.updateMany(
          { tenantId, metaAdAccountId: cleanAccount, metaAdId: payload.metaAdId },
          { $set: { ...propagatePatch, updatedAt: new Date() } }
        ),
      ]);
      return saved.toJSON();
    }

    const mapKey = `${tenantId}:${cleanAccount}:${payload.metaAdId}`;
    const existing = mappingMemoryStore.get(mapKey);
    let savedDoc;
    if (existing) {
      Object.assign(existing, docPatch);
      savedDoc = { ...existing };
    } else {
      const id = newId();
      const created = { id, _id: id, ...docPatch, createdAt: new Date() };
      mappingMemoryStore.set(mapKey, created);
      savedDoc = { ...created };
    }

    for (const snap of insightMemoryStore.values()) {
      if (
        snap.tenantId === tenantId &&
        snap.metaAdAccountId === cleanAccount &&
        snap.metaAdId === payload.metaAdId
      ) {
        Object.assign(snap, propagatePatch, { updatedAt: new Date() });
      }
    }

    return savedDoc;
  }

  static async listCreativeMappings(tenantId, { metaAdAccountId, adPilotCampaignId, origin } = {}) {
    if (isMongoConnected()) {
      const query = { tenantId };
      if (metaAdAccountId) query.metaAdAccountId = metaAdAccountId;
      if (adPilotCampaignId) query.adPilotCampaignId = adPilotCampaignId;
      if (origin) query.origin = origin;
      const rows = await MetaCreativeMapping.find(query).sort({ updatedAt: -1 });
      return rows.map((r) => r.toJSON());
    }

    return Array.from(mappingMemoryStore.values())
      .filter((m) => {
        if (m.tenantId !== tenantId) return false;
        if (metaAdAccountId && m.metaAdAccountId !== metaAdAccountId) return false;
        if (adPilotCampaignId && normalizeId(m.adPilotCampaignId) !== normalizeId(adPilotCampaignId)) {
          return false;
        }
        if (origin && m.origin !== origin) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  static async deleteCreativeMapping(id, tenantId) {
    if (isMongoConnected()) {
      return await MetaCreativeMapping.findOneAndDelete({ _id: id, tenantId });
    }
    for (const [k, v] of mappingMemoryStore.entries()) {
      if (v.tenantId === tenantId && (v.id === id || v._id === id)) {
        mappingMemoryStore.delete(k);
        return v;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Idempotent Insight Snapshots & Rollups
  // ---------------------------------------------------------------------------
  static async upsertInsightSnapshot(tenantId, row) {
    const docData = {
      ...row,
      tenantId,
      updatedAt: new Date(),
    };

    if (isMongoConnected()) {
      const saved = await MetaInsightSnapshot.findOneAndUpdate(
        { tenantId, syncKey: row.syncKey },
        { $set: docData, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true }
      );
      return saved.toJSON();
    }

    const memKey = `${tenantId}:${row.syncKey}`;
    const existing = insightMemoryStore.get(memKey);
    if (existing) {
      Object.assign(existing, docData);
      return { ...existing };
    }
    const id = newId();
    const created = { id, _id: id, ...docData, createdAt: new Date() };
    insightMemoryStore.set(memKey, created);
    return { ...created };
  }

  static async queryInsightSnapshots(
    tenantId,
    {
      since,
      until,
      metaAdAccountId,
      adPilotCampaignId,
      origin,
      breakdownKey,
      includeBreakdowns = false,
      includeTestFixtures = true,
    } = {}
  ) {
    if (isMongoConnected()) {
      const query = { tenantId };
      if (metaAdAccountId) query.metaAdAccountId = metaAdAccountId;
      if (adPilotCampaignId) query.adPilotCampaignId = adPilotCampaignId;
      if (origin) query.origin = origin;
      if (!includeBreakdowns && !breakdownKey) {
        query.breakdownKey = 'none';
      } else if (breakdownKey) {
        query.breakdownKey = breakdownKey;
      }
      if (!includeTestFixtures) {
        query.isTestFixture = false;
      }
      if (since || until) {
        query.dateStart = {};
        if (since) query.dateStart.$gte = since;
        if (until) query.dateStart.$lte = until;
      }
      const rows = await MetaInsightSnapshot.find(query).sort({ dateStart: 1 });
      return rows.map((r) => r.toJSON());
    }

    return Array.from(insightMemoryStore.values())
      .filter((r) => {
        if (r.tenantId !== tenantId) return false;
        if (metaAdAccountId && r.metaAdAccountId !== metaAdAccountId) return false;
        if (adPilotCampaignId && normalizeId(r.adPilotCampaignId) !== normalizeId(adPilotCampaignId)) {
          return false;
        }
        if (origin && r.origin !== origin) return false;
        if (!includeBreakdowns && !breakdownKey && r.breakdownKey !== 'none') return false;
        if (breakdownKey && r.breakdownKey !== breakdownKey) return false;
        if (!includeTestFixtures && r.isTestFixture) return false;
        if (since && r.dateStart < since) return false;
        if (until && r.dateStart > until) return false;
        return true;
      })
      .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  }

  static async clearTestFixtureData(tenantId) {
    if (isMongoConnected()) {
      await Promise.all([
        MetaInsightSnapshot.deleteMany({ tenantId, isTestFixture: true }),
        MetaCreativeMapping.deleteMany({ tenantId, isTestFixture: true }),
        MetaSyncRun.deleteMany({ tenantId, isTestFixture: true }),
      ]);
      return;
    }

    for (const [k, v] of insightMemoryStore.entries()) {
      if (v.tenantId === tenantId && v.isTestFixture) insightMemoryStore.delete(k);
    }
    for (const [k, v] of mappingMemoryStore.entries()) {
      if (v.tenantId === tenantId && v.isTestFixture) mappingMemoryStore.delete(k);
    }
    for (const [k, v] of syncRunMemoryStore.entries()) {
      if (v.tenantId === tenantId && v.isTestFixture) syncRunMemoryStore.delete(k);
    }
  }

  static async upsertCampaignPerformanceRollup(tenantId, rollup) {
    if (!rollup.campaignId || !mongoose.Types.ObjectId.isValid(String(rollup.campaignId))) {
      return null;
    }
    const dateObj = new Date(`${rollup.dateStart}T00:00:00.000Z`);
    if (Number.isNaN(dateObj.getTime())) return null;

    const patch = {
      tenantId,
      campaignId: rollup.campaignId,
      creativeId: rollup.creativeId || undefined,
      date: dateObj,
      impressions: rollup.impressions || 0,
      clicks: rollup.linkClicks || 0,
      linkClicks: rollup.linkClicks || 0,
      conversions: rollup.purchases || 0,
      spend: rollup.spend || 0,
      ctr: rollup.linkCtr || 0,
      cpc: rollup.cpc || 0,
      roas: rollup.roas || 0,
      purchaseValue: rollup.purchaseValue || 0,
      cpa: rollup.cpa ?? null,
      currency: rollup.currency || 'USD',
      source: 'meta_marketing_api',
    };

    if (isMongoConnected()) {
      const saved = await CampaignPerformance.findOneAndUpdate(
        { tenantId, campaignId: rollup.campaignId, date: dateObj },
        { $set: patch },
        { upsert: true, new: true }
      );
      return saved.toJSON();
    }

    const key = `${tenantId}:${rollup.campaignId}:${rollup.dateStart}`;
    campaignPerfMemoryStore.set(key, { id: key, ...patch });
    return campaignPerfMemoryStore.get(key);
  }

  // ---------------------------------------------------------------------------
  // Sync Runs History
  // ---------------------------------------------------------------------------
  static async createSyncRun(data) {
    if (isMongoConnected()) {
      const created = new MetaSyncRun(data);
      const saved = await created.save();
      return saved.toJSON();
    }
    const id = newId();
    const doc = { id, _id: id, ...data, createdAt: new Date(), updatedAt: new Date() };
    syncRunMemoryStore.set(id, doc);
    return { ...doc };
  }

  static async updateSyncRun(id, tenantId, patch) {
    if (isMongoConnected()) {
      const updated = await MetaSyncRun.findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      );
      return updated ? updated.toJSON() : null;
    }
    const doc = syncRunMemoryStore.get(normalizeId(id));
    if (!doc || doc.tenantId !== tenantId) return null;
    Object.assign(doc, patch, { updatedAt: new Date() });
    return { ...doc };
  }

  static async listSyncRuns(tenantId, limit = 15) {
    if (isMongoConnected()) {
      const rows = await MetaSyncRun.find({ tenantId }).sort({ createdAt: -1 }).limit(limit);
      return rows.map((r) => r.toJSON());
    }
    return Array.from(syncRunMemoryStore.values())
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  static clearMemoryStore() {
    connectionMemoryStore.clear();
    mappingMemoryStore.clear();
    insightMemoryStore.clear();
    syncRunMemoryStore.clear();
    campaignPerfMemoryStore.clear();
  }
}
