import mongoose from 'mongoose';
import { Creative } from '../models/Creative.js';
import { AdCopy } from '../models/AdCopy.js';

const creativeMemoryStore = new Map();
const adCopyMemoryStore = new Map();

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
  if (typeof doc.toJSON === 'function') {
    return doc.toJSON();
  }
  const clone = { ...doc };
  if (!clone.id && clone._id) {
    clone.id = normalizeId(clone._id);
  }
  return clone;
}

export class CreativeRepository {
  /**
   * Create a new creative asset record (MongoDB with in-memory fallback).
   */
  static async createCreative(creativeData) {
    if (isMongoConnected()) {
      const creative = new Creative({
        version: 1,
        versionHistory: [],
        ...creativeData,
      });
      return await creative.save();
    }

    const id = new mongoose.Types.ObjectId().toString();
    const now = new Date();
    const doc = {
      id,
      _id: id,
      version: 1,
      versionHistory: [],
      approved: false,
      approvalStatus: 'pending',
      status: 'ready',
      overlaySpec: {},
      blueprint: {},
      metadata: {},
      ...creativeData,
      campaignId: normalizeId(creativeData.campaignId),
      createdAt: now,
      updatedAt: now,
    };
    creativeMemoryStore.set(id, doc);
    return doc;
  }

  /**
   * Create an ad copy record linked to a campaign and optionally a creative.
   */
  static async createAdCopy(adCopyData) {
    if (isMongoConnected()) {
      const adCopy = new AdCopy(adCopyData);
      return await adCopy.save();
    }

    const id = new mongoose.Types.ObjectId().toString();
    const now = new Date();
    const doc = {
      id,
      _id: id,
      primaryTexts: [],
      headlines: [],
      descriptions: [],
      supportingEvidence: [],
      language: 'en',
      ...adCopyData,
      campaignId: normalizeId(adCopyData.campaignId),
      creativeId: normalizeId(adCopyData.creativeId),
      createdAt: now,
      updatedAt: now,
    };
    adCopyMemoryStore.set(id, doc);
    return doc;
  }

  /**
   * Find all creatives and ad copies for a specific campaign.
   */
  static async findByCampaignId(campaignId, tenantId, { includeArchived = false } = {}) {
    const cid = normalizeId(campaignId);

    if (isMongoConnected()) {
      const creativeQuery = { campaignId: cid };
      const copyQuery = { campaignId: cid };
      if (tenantId) {
        creativeQuery.tenantId = tenantId;
        copyQuery.tenantId = tenantId;
      }
      if (!includeArchived) {
        creativeQuery.status = { $ne: 'archived' };
      }

      const [creatives, adCopies] = await Promise.all([
        Creative.find(creativeQuery).sort({ createdAt: -1 }),
        AdCopy.find(copyQuery).sort({ createdAt: -1 }),
      ]);

      return {
        creatives,
        adCopies,
        count: {
          creatives: creatives.length,
          adCopies: adCopies.length,
        },
      };
    }

    const creatives = Array.from(creativeMemoryStore.values())
      .filter((c) => {
        if (normalizeId(c.campaignId) !== cid) return false;
        if (tenantId && c.tenantId !== tenantId) return false;
        if (!includeArchived && c.status === 'archived') return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const adCopies = Array.from(adCopyMemoryStore.values())
      .filter((a) => {
        if (normalizeId(a.campaignId) !== cid) return false;
        if (tenantId && a.tenantId !== tenantId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      creatives,
      adCopies,
      count: {
        creatives: creatives.length,
        adCopies: adCopies.length,
      },
    };
  }

  /**
   * List ad copies across campaigns for analytics metadata extraction.
   */
  static async listAdCopies({ tenantId, campaignId, creativeIds } = {}) {
    if (isMongoConnected()) {
      const query = {};
      if (tenantId) query.tenantId = tenantId;
      if (campaignId) query.campaignId = normalizeId(campaignId);
      if (Array.isArray(creativeIds) && creativeIds.length > 0) {
        query.creativeId = { $in: creativeIds.map(normalizeId) };
      }
      return await AdCopy.find(query).sort({ createdAt: -1 }).limit(500);
    }

    const idSet = Array.isArray(creativeIds) ? new Set(creativeIds.map(normalizeId)) : null;
    return Array.from(adCopyMemoryStore.values())
      .filter((a) => {
        if (tenantId && a.tenantId !== tenantId) return false;
        if (campaignId && normalizeId(a.campaignId) !== normalizeId(campaignId)) return false;
        if (idSet && !idSet.has(normalizeId(a.creativeId))) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * List creatives across campaigns with filtering for the Creative Gallery.
   */
  static async findAll({
    tenantId,
    assetType,
    status,
    approved,
    campaignId,
    placement,
    includeArchived = false,
    page = 1,
    limit = 50,
  } = {}) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));

    if (isMongoConnected()) {
      const query = {};
      if (tenantId) query.tenantId = tenantId;
      if (assetType) query.assetType = assetType;
      if (status) {
        query.status = status;
      } else if (!includeArchived) {
        query.status = { $ne: 'archived' };
      }
      if (approved !== undefined && approved !== null && approved !== '') {
        query.approved = approved === true || approved === 'true';
      }
      if (campaignId) query.campaignId = campaignId;
      if (placement) query.placement = placement;

      const skip = (pageNum - 1) * limitNum;
      const [items, total] = await Promise.all([
        Creative.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
        Creative.countDocuments(query),
      ]);

      return {
        items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.max(1, Math.ceil(total / limitNum)),
          hasNextPage: pageNum * limitNum < total,
          hasPrevPage: pageNum > 1,
        },
      };
    }

    let docs = Array.from(creativeMemoryStore.values()).filter((c) => {
      if (tenantId && c.tenantId !== tenantId) return false;
      if (assetType && c.assetType !== assetType) return false;
      if (status) {
        if (c.status !== status) return false;
      } else if (!includeArchived && c.status === 'archived') {
        return false;
      }
      if (approved !== undefined && approved !== null && approved !== '') {
        const flag = approved === true || approved === 'true';
        if (Boolean(c.approved) !== flag) return false;
      }
      if (campaignId && normalizeId(c.campaignId) !== normalizeId(campaignId)) return false;
      if (placement && c.placement !== placement) return false;
      return true;
    });

    docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = docs.length;
    const skip = (pageNum - 1) * limitNum;
    const items = docs.slice(skip, skip + limitNum);

    return {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        hasNextPage: pageNum * limitNum < total,
        hasPrevPage: pageNum > 1,
      },
    };
  }

  /**
   * Find a single creative by ID or creativeKey within tenant boundary.
   */
  static async findById(creativeId, tenantId) {
    const cid = normalizeId(creativeId);

    if (isMongoConnected()) {
      const orClauses = [{ creativeKey: cid }];
      if (mongoose.Types.ObjectId.isValid(cid)) {
        orClauses.unshift({ _id: cid });
      }
      const query = { $or: orClauses };
      if (tenantId) query.tenantId = tenantId;
      return await Creative.findOne(query);
    }

    const direct = creativeMemoryStore.get(cid);
    if (direct && (!tenantId || direct.tenantId === tenantId)) {
      return direct;
    }

    for (const doc of creativeMemoryStore.values()) {
      if (doc.creativeKey === cid && (!tenantId || doc.tenantId === tenantId)) {
        return doc;
      }
    }
    return null;
  }

  /**
   * Find ad copies linked to a creative (or fallback to campaign copies).
   */
  static async findAdCopiesByCreativeId(creativeId, campaignId, tenantId) {
    const crId = normalizeId(creativeId);
    const cpId = normalizeId(campaignId);

    if (isMongoConnected()) {
      const query = { $or: [{ creativeId: crId }] };
      if (cpId) query.$or.push({ campaignId: cpId, creativeId: { $exists: false } });
      if (tenantId) query.tenantId = tenantId;
      return await AdCopy.find(query).sort({ createdAt: -1 });
    }

    return Array.from(adCopyMemoryStore.values())
      .filter((a) => {
        if (tenantId && a.tenantId !== tenantId) return false;
        if (normalizeId(a.creativeId) === crId) return true;
        if (cpId && normalizeId(a.campaignId) === cpId && !a.creativeId) return true;
        return false;
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Update mutable studio metadata and overlay instructions on an individual creative.
   */
  static async updateCreative(creativeId, tenantId, patch) {
    const existing = await this.findById(creativeId, tenantId);
    if (!existing) return null;

    if (isMongoConnected()) {
      return await Creative.findOneAndUpdate(
        { _id: existing._id },
        { $set: { ...patch, updatedAt: new Date() } },
        { new: true }
      );
    }

    Object.assign(existing, patch, { updatedAt: new Date() });
    return existing;
  }

  /**
   * Archive previous asset version in versionHistory and promote regenerated creative details.
   */
  static async pushCreativeVersion(creativeId, tenantId, newPatch) {
    const current = await this.findById(creativeId, tenantId);
    if (!current) return null;

    const plain = toPlain(current);
    const snapshot = {
      version: plain.version || 1,
      storageKey: plain.storageKey,
      bucket: plain.bucket,
      presignedUrl: plain.presignedUrl || null,
      promptUsed: plain.promptUsed || '',
      overlaySpec: plain.overlaySpec || {},
      backgroundDirection: plain.backgroundDirection || '',
      creativeInstructions: plain.creativeInstructions || '',
      approved: Boolean(plain.approved),
      approvalStatus: plain.approvalStatus || 'pending',
      evaluation: plain.evaluation || null,
      dimensions: plain.dimensions || null,
      format: plain.format || null,
      archivedAt: new Date().toISOString(),
    };

    const nextVersion = (plain.version || 1) + 1;

    if (isMongoConnected()) {
      return await Creative.findOneAndUpdate(
        { _id: current._id },
        {
          $set: {
            ...newPatch,
            version: nextVersion,
            updatedAt: new Date(),
          },
          $push: {
            versionHistory: snapshot,
          },
        },
        { new: true }
      );
    }

    current.versionHistory = [...(current.versionHistory || []), snapshot];
    Object.assign(current, newPatch, {
      version: nextVersion,
      updatedAt: new Date(),
    });
    return current;
  }

  /**
   * Create or update the primary AdCopy associated with a specific creative.
   */
  static async upsertAdCopyForCreative(campaignId, creativeId, tenantId, copyPatch) {
    const crId = normalizeId(creativeId);
    const cpId = normalizeId(campaignId);

    if (isMongoConnected()) {
      const existing = await AdCopy.findOne({ campaignId: cpId, creativeId: crId, tenantId });
      if (existing) {
        return await AdCopy.findOneAndUpdate(
          { _id: existing._id },
          { $set: { ...copyPatch, updatedAt: new Date() } },
          { new: true }
        );
      }
      return await this.createAdCopy({
        tenantId,
        campaignId: cpId,
        creativeId: crId,
        headline: copyPatch.headline || (copyPatch.headlines && copyPatch.headlines[0]) || 'Ad Headline',
        primaryText:
          copyPatch.primaryText || (copyPatch.primaryTexts && copyPatch.primaryTexts[0]) || 'Primary ad copy',
        ...copyPatch,
      });
    }

    for (const copy of adCopyMemoryStore.values()) {
      if (
        normalizeId(copy.creativeId) === crId &&
        normalizeId(copy.campaignId) === cpId &&
        (!tenantId || copy.tenantId === tenantId)
      ) {
        Object.assign(copy, copyPatch, { updatedAt: new Date() });
        return copy;
      }
    }

    return await this.createAdCopy({
      tenantId,
      campaignId: cpId,
      creativeId: crId,
      headline: copyPatch.headline || (copyPatch.headlines && copyPatch.headlines[0]) || 'Ad Headline',
      primaryText:
        copyPatch.primaryText || (copyPatch.primaryTexts && copyPatch.primaryTexts[0]) || 'Primary ad copy',
      ...copyPatch,
    });
  }

  /**
   * Archive active creatives on a campaign when full campaign regeneration is triggered.
   */
  static async archiveByCampaignId(campaignId, tenantId) {
    const cid = normalizeId(campaignId);

    if (isMongoConnected()) {
      const query = { campaignId: cid, status: { $ne: 'archived' } };
      if (tenantId) query.tenantId = tenantId;
      return await Creative.updateMany(query, { $set: { status: 'archived', updatedAt: new Date() } });
    }

    for (const doc of creativeMemoryStore.values()) {
      if (normalizeId(doc.campaignId) === cid && (!tenantId || doc.tenantId === tenantId)) {
        if (doc.status !== 'archived') {
          doc.status = 'archived';
          doc.updatedAt = new Date();
        }
      }
    }
  }

  /**
   * Aggregate real creative counts for the dashboard and analytics views.
   */
  static async getAggregateStats(tenantId) {
    if (isMongoConnected()) {
      const baseMatch = { status: { $ne: 'archived' } };
      if (tenantId) baseMatch.tenantId = tenantId;

      const [totalCreatives, approvedCreatives, rejectedCreatives, imageCreatives, videoCreatives] =
        await Promise.all([
          Creative.countDocuments(baseMatch),
          Creative.countDocuments({ ...baseMatch, approved: true }),
          Creative.countDocuments({ ...baseMatch, approvalStatus: 'rejected' }),
          Creative.countDocuments({ ...baseMatch, assetType: 'image' }),
          Creative.countDocuments({ ...baseMatch, assetType: 'video' }),
        ]);

      return {
        totalCreatives,
        approvedCreatives,
        rejectedCreatives,
        pendingCreatives: Math.max(0, totalCreatives - approvedCreatives - rejectedCreatives),
        imageCreatives,
        videoCreatives,
      };
    }

    const active = Array.from(creativeMemoryStore.values()).filter(
      (c) => (!tenantId || c.tenantId === tenantId) && c.status !== 'archived'
    );

    const totalCreatives = active.length;
    const approvedCreatives = active.filter((c) => Boolean(c.approved) || c.approvalStatus === 'approved').length;
    const rejectedCreatives = active.filter((c) => c.approvalStatus === 'rejected').length;
    const imageCreatives = active.filter((c) => c.assetType === 'image').length;
    const videoCreatives = active.filter((c) => c.assetType === 'video').length;

    return {
      totalCreatives,
      approvedCreatives,
      rejectedCreatives,
      pendingCreatives: Math.max(0, totalCreatives - approvedCreatives - rejectedCreatives),
      imageCreatives,
      videoCreatives,
    };
  }

  static clearMemoryStore() {
    creativeMemoryStore.clear();
    adCopyMemoryStore.clear();
  }
}
