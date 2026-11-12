// ==============================================================================
// AdPilot AI — MongoDB Initialization & Collection Schema Validation
// ==============================================================================

const dbName = process.env.MONGO_INITDB_DATABASE || 'adpilot';
const appUser = process.env.MONGO_APP_USER || 'adpilot_user';
const appPassword = process.env.MONGO_APP_PASSWORD || 'adpilot_password';

const adminDb = db.getSiblingDB('admin');
const targetDb = db.getSiblingDB(dbName);

print(`[mongo-init] Initializing database: ${dbName}`);

// Create application user with readWrite privileges
try {
  targetDb.createUser({
    user: appUser,
    pwd: appPassword,
    roles: [
      { role: 'readWrite', db: dbName },
      { role: 'dbAdmin', db: dbName },
    ],
  });
  print(`[mongo-init] Created user: ${appUser}`);
} catch (e) {
  print(`[mongo-init] User creation note: ${e.message}`);
}

// ------------------------------------------------------------------------------
// 1. users
// ------------------------------------------------------------------------------
targetDb.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'email', 'name', 'role', 'status', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        email: {
          bsonType: 'string',
          pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        },
        name: { bsonType: 'string', minLength: 1 },
        passwordHash: { bsonType: 'string' },
        role: { enum: ['admin', 'manager', 'editor', 'viewer'] },
        status: { enum: ['active', 'suspended', 'pending'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.users.createIndex({ email: 1 }, { unique: true });
targetDb.users.createIndex({ tenantId: 1, role: 1 });

// ------------------------------------------------------------------------------
// 2. products
// ------------------------------------------------------------------------------
targetDb.createCollection('products', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'title', 'status', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        sku: { bsonType: 'string' },
        title: { bsonType: 'string', minLength: 1 },
        description: { bsonType: 'string' },
        category: { bsonType: 'string' },
        price: { bsonType: 'number', minimum: 0 },
        currency: { bsonType: 'string', minLength: 3, maxLength: 3 },
        url: { bsonType: 'string' },
        images: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['storageKey', 'url'],
            properties: {
              storageKey: { bsonType: 'string' },
              url: { bsonType: 'string' },
              isPrimary: { bsonType: 'bool' },
            },
          },
        },
        attributes: { bsonType: 'object' },
        status: { enum: ['draft', 'active', 'archived'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.products.createIndex({ tenantId: 1, sku: 1 }, { unique: true, sparse: true });
targetDb.products.createIndex({ tenantId: 1, status: 1, createdAt: -1 });

// ------------------------------------------------------------------------------
// 3. campaigns
// ------------------------------------------------------------------------------
targetDb.createCollection('campaigns', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'userId', 'name', 'status', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        userId: { bsonType: ['objectId', 'string'] },
        productId: { bsonType: ['objectId', 'string', 'null'] },
        name: { bsonType: 'string', minLength: 1 },
        objective: { enum: ['conversions', 'brand_awareness', 'traffic', 'retargeting'] },
        budget: {
          bsonType: 'object',
          required: ['amount', 'currency', 'type'],
          properties: {
            amount: { bsonType: 'number', minimum: 0 },
            currency: { bsonType: 'string' },
            type: { enum: ['daily', 'lifetime'] },
          },
        },
        platforms: {
          bsonType: 'array',
          items: { bsonType: 'string' },
        },
        targetAudience: { bsonType: 'object' },
        status: {
          enum: [
            'INITIALIZED',
            'QUEUED',
            'EXTRACTING_PRODUCT',
            'ANALYZING_PRODUCT',
            'GENERATING_STRATEGY',
            'PLANNING_CREATIVES',
            'GENERATING_ASSETS',
            'EVALUATING_CREATIVES',
            'GENERATING_COPY',
            'ASSEMBLING_CAMPAIGN',
            'COMPLETED',
            'FAILED',
            'draft',
            'generating',
            'ready',
            'active',
            'paused',
            'completed',
            'failed',
          ],
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.campaigns.createIndex({ tenantId: 1, status: 1, createdAt: -1 });
targetDb.campaigns.createIndex({ tenantId: 1, productId: 1 });

// ------------------------------------------------------------------------------
// 4. campaign_runs
// ------------------------------------------------------------------------------
targetDb.createCollection('campaign_runs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'campaignId', 'runNumber', 'status', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: 'string' },
        runNumber: { bsonType: 'int', minimum: 1 },
        status: { enum: ['queued', 'analyzing', 'generating', 'evaluating', 'completed', 'failed'] },
        jobId: { bsonType: 'string' },
        startedAt: { bsonType: 'date' },
        completedAt: { bsonType: 'date' },
        error: { bsonType: 'string' },
        metricsSummary: { bsonType: 'object' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.campaign_runs.createIndex({ tenantId: 1, campaignId: 1, runNumber: 1 }, { unique: true });
targetDb.campaign_runs.createIndex({ status: 1, createdAt: -1 });

// ------------------------------------------------------------------------------
// 5. marketing_strategies
// ------------------------------------------------------------------------------
targetDb.createCollection('marketing_strategies', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'campaignId', 'version', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: 'string' },
        version: { bsonType: 'int', minimum: 1 },
        targetPersona: { bsonType: 'object' },
        keyMessaging: { bsonType: 'array', items: { bsonType: 'string' } },
        valuePropositions: { bsonType: 'array', items: { bsonType: 'string' } },
        toneOfVoice: { bsonType: 'string' },
        competitorAngles: { bsonType: 'array', items: { bsonType: 'string' } },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.marketing_strategies.createIndex({ tenantId: 1, campaignId: 1, version: 1 }, { unique: true });

// ------------------------------------------------------------------------------
// 6. creative_concepts
// ------------------------------------------------------------------------------
targetDb.createCollection('creative_concepts', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'campaignId', 'title', 'aspectRatio', 'status', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: 'string' },
        strategyId: { bsonType: 'string' },
        title: { bsonType: 'string', minLength: 1 },
        hook: { bsonType: 'string' },
        visualPrompt: { bsonType: 'string' },
        aspectRatio: { enum: ['1:1', '9:16', '16:9', '4:5'] },
        targetPlatform: { enum: ['meta', 'tiktok', 'google', 'instagram'] },
        status: { enum: ['draft', 'approved', 'rejected'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.creative_concepts.createIndex({ tenantId: 1, campaignId: 1, status: 1 });

// ------------------------------------------------------------------------------
// 7. creatives
// ------------------------------------------------------------------------------
targetDb.createCollection('creatives', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'campaignId', 'assetType', 'storageKey', 'status', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: ['objectId', 'string'] },
        conceptId: { bsonType: ['objectId', 'string', 'null'] },
        assetType: { enum: ['image', 'video'] },
        storageKey: { bsonType: 'string', minLength: 1 },
        bucket: { bsonType: 'string' },
        format: { bsonType: 'string' },
        dimensions: {
          bsonType: 'object',
          properties: {
            width: { bsonType: ['int', 'long', 'double', 'number'] },
            height: { bsonType: ['int', 'long', 'double', 'number'] },
          },
        },
        fileSizeBytes: { bsonType: 'number', minimum: 0 },
        status: { enum: ['generating', 'ready', 'approved', 'rejected', 'failed', 'archived'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.creatives.createIndex({ tenantId: 1, campaignId: 1, status: 1 });
targetDb.creatives.createIndex({ storageKey: 1 }, { unique: true });

// ------------------------------------------------------------------------------
// 8. creative_evaluations
// ------------------------------------------------------------------------------
targetDb.createCollection('creative_evaluations', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'creativeId', 'overallScore', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        creativeId: { bsonType: ['objectId', 'string'] },
        visualScore: { bsonType: 'number', minimum: 0, maximum: 100 },
        complianceScore: { bsonType: 'number', minimum: 0, maximum: 100 },
        predictedCtr: { bsonType: 'number', minimum: 0 },
        overallScore: { bsonType: 'number', minimum: 0, maximum: 100 },
        critiqueNotes: { bsonType: 'string' },
        evaluatorVersion: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.creative_evaluations.createIndex({ tenantId: 1, creativeId: 1 }, { unique: true });

// ------------------------------------------------------------------------------
// 9. ad_copies
// ------------------------------------------------------------------------------
targetDb.createCollection('ad_copies', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'campaignId', 'primaryText', 'headline', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: ['objectId', 'string'] },
        creativeId: { bsonType: ['objectId', 'string', 'null'] },
        primaryText: { bsonType: 'string', minLength: 1 },
        headline: { bsonType: 'string', minLength: 1 },
        description: { bsonType: 'string' },
        callToAction: { bsonType: 'string' },
        platform: { bsonType: 'string' },
        language: { bsonType: 'string', minLength: 2, maxLength: 5 },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.ad_copies.createIndex({ tenantId: 1, campaignId: 1 });

// ------------------------------------------------------------------------------
// 10. campaign_performance
// ------------------------------------------------------------------------------
targetDb.createCollection('campaign_performance', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'campaignId', 'date', 'impressions', 'clicks', 'spend', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: 'string' },
        creativeId: { bsonType: 'string' },
        date: { bsonType: 'date' },
        impressions: { bsonType: 'number', minimum: 0 },
        clicks: { bsonType: 'number', minimum: 0 },
        conversions: { bsonType: 'number', minimum: 0 },
        spend: { bsonType: 'number', minimum: 0 },
        ctr: { bsonType: 'number', minimum: 0 },
        cpc: { bsonType: 'number', minimum: 0 },
        roas: { bsonType: 'number', minimum: 0 },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.campaign_performance.createIndex({ tenantId: 1, campaignId: 1, date: 1 }, { unique: true });

// ------------------------------------------------------------------------------
// 11. optimization_insights
// ------------------------------------------------------------------------------
targetDb.createCollection('optimization_insights', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tenantId', 'insightType', 'recommendation', 'confidenceScore', 'createdAt', 'updatedAt'],
      properties: {
        tenantId: { bsonType: 'string' },
        campaignId: { bsonType: ['objectId', 'string', 'null'] },
        creativeId: { bsonType: ['objectId', 'string', 'null'] },
        insightType: {
          enum: [
            'creative_fatigue',
            'budget_allocation',
            'audience_refinement',
            'copy_variation',
            'test_different_hook',
            'expand_promising_concept',
            'change_opening_scene',
            'test_another_placement',
            'improve_product_visibility',
            'revise_ad_copy',
            'insufficient_data_warning',
          ],
        },
        recommendation: { bsonType: 'string', minLength: 1 },
        confidenceScore: { bsonType: 'number', minimum: 0, maximum: 1 },
        impactLevel: { enum: ['low', 'medium', 'high'] },
        actionStatus: { enum: ['pending', 'applied', 'dismissed'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
});
targetDb.optimization_insights.createIndex({ tenantId: 1, campaignId: 1, insightType: 1 });

print('[mongo-init] Successfully created all 11 collections, validation schemas, and indexes.');

