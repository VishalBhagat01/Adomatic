import mongoose from 'mongoose';
import { Creative } from '../models/Creative.js';
import { AdCopy } from '../models/AdCopy.js';

export class CreativeRepository {
  /**
   * Find all creatives and ad copies for a specific campaign.
   */
  static async findByCampaignId(campaignId, tenantId) {
    if (mongoose.connection.readyState === 1) {
      const query = { campaignId };
      if (tenantId) query.tenantId = tenantId;

      const [creatives, adCopies] = await Promise.all([
        Creative.find(query).sort({ createdAt: -1 }),
        AdCopy.find(query).sort({ createdAt: -1 }),
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

    return {
      creatives: [],
      adCopies: [],
      count: {
        creatives: 0,
        adCopies: 0,
      },
    };
  }
}
