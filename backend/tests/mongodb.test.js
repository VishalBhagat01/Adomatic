import { test, describe } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  User,
  Product,
  Campaign,
  CampaignRun,
  MarketingStrategy,
  CreativeConcept,
  Creative,
  CreativeEvaluation,
  AdCopy,
  CampaignPerformance,
  OptimizationInsight,
} from '../src/models/index.js';

describe('MongoDB Schema & Validation Invariants', () => {
  test('User model requires valid email and mandatory fields', () => {
    const invalidUser = new User({ name: 'Test' });
    const err = invalidUser.validateSync();
    assert.ok(err.errors.email, 'email should be required');
    assert.ok(err.errors.tenantId, 'tenantId should be required');

    const badEmailUser = new User({
      tenantId: 't1',
      name: 'John',
      email: 'not-an-email',
    });
    const emailErr = badEmailUser.validateSync();
    assert.ok(emailErr.errors.email, 'invalid email format should fail validation');

    const validUser = new User({
      tenantId: 'tenant_123',
      name: 'Alice',
      email: 'alice@adpilot.ai',
      role: 'admin',
    });
    assert.strictEqual(validUser.validateSync(), undefined);
    assert.strictEqual(validUser.role, 'admin');
    assert.strictEqual(validUser.status, 'active');
  });

  test('Product model validates non-negative price and structured images', () => {
    const negPriceProduct = new Product({
      tenantId: 't1',
      title: 'Sneakers',
      price: -10,
    });
    const err = negPriceProduct.validateSync();
    assert.ok(err.errors.price, 'negative price should fail validation');

    const validProduct = new Product({
      tenantId: 't1',
      sku: 'SKU-001',
      title: 'Performance Sneakers',
      category: 'Footwear',
      price: 99.99,
      currency: 'USD',
      images: [{ storageKey: 'tenants/t1/products/p1/shoe.webp', url: 'https://example.com/shoe.webp', isPrimary: true }],
    });
    assert.strictEqual(validProduct.validateSync(), undefined);
    assert.strictEqual(validProduct.images.length, 1);
    assert.strictEqual(validProduct.images[0].isPrimary, true);
  });

  test('Campaign model enforces lifecycle status, productUrl and prompt', () => {
    const badCampaign = new Campaign({
      tenantId: 't1',
      userId: new mongoose.Types.ObjectId(),
      name: 'Spring Sale',
      status: 'invalid_status',
    });
    const err = badCampaign.validateSync();
    assert.ok(err.errors.status, 'invalid status should be rejected');
    assert.ok(err.errors.productUrl, 'productUrl is required');
    assert.ok(err.errors.userPrompt, 'userPrompt is required');

    const validCampaign = new Campaign({
      tenantId: 't1',
      userId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      name: 'Summer Conversions',
      productUrl: 'https://example.com/products/sneaker',
      userPrompt: 'Promote our high-performance running shoes.',
      formats: ['image', 'video'],
      placements: ['instagram_feed'],
    });
    assert.strictEqual(validCampaign.validateSync(), undefined);
    assert.strictEqual(validCampaign.formats.length, 2);
  });

  test('CampaignRun model tracks run number, status, and timestamps', () => {
    const run = new CampaignRun({
      tenantId: 't1',
      campaignId: new mongoose.Types.ObjectId(),
      runNumber: 1,
      status: 'queued',
      jobId: 'job_abc123',
    });
    assert.strictEqual(run.validateSync(), undefined);
    assert.strictEqual(run.runNumber, 1);
  });

  test('Creative model validates assetType and storageKey uniqueness constraints', () => {
    const badCreative = new Creative({
      tenantId: 't1',
      campaignId: new mongoose.Types.ObjectId(),
      conceptId: new mongoose.Types.ObjectId(),
      assetType: 'audio', // forbidden enum
      storageKey: 'key1',
    });
    const err = badCreative.validateSync();
    assert.ok(err.errors.assetType, 'assetType must be image or video');

    const validCreative = new Creative({
      tenantId: 't1',
      campaignId: new mongoose.Types.ObjectId(),
      conceptId: new mongoose.Types.ObjectId(),
      assetType: 'image',
      storageKey: 'tenants/t1/creatives/c1/banner.png',
      format: 'png',
      dimensions: { width: 1080, height: 1080 },
      fileSizeBytes: 245000,
    });
    assert.strictEqual(validCreative.validateSync(), undefined);
  });

  test('CreativeEvaluation enforces 0-100 score bounds', () => {
    const badEval = new CreativeEvaluation({
      tenantId: 't1',
      creativeId: new mongoose.Types.ObjectId(),
      overallScore: 120, // out of bounds
    });
    const err = badEval.validateSync();
    assert.ok(err.errors.overallScore, 'overallScore cannot exceed 100');

    const validEval = new CreativeEvaluation({
      tenantId: 't1',
      creativeId: new mongoose.Types.ObjectId(),
      visualScore: 88,
      complianceScore: 95,
      predictedCtr: 3.4,
      overallScore: 91,
      critiqueNotes: 'High contrast hook, compliant logo placement.',
    });
    assert.strictEqual(validEval.validateSync(), undefined);
  });

  test('All 11 models define consistent JSON transform with string id', () => {
    const models = [
      User,
      Product,
      Campaign,
      CampaignRun,
      MarketingStrategy,
      CreativeConcept,
      Creative,
      CreativeEvaluation,
      AdCopy,
      CampaignPerformance,
      OptimizationInsight,
    ];

    for (const Model of models) {
      assert.ok(Model.schema.options.timestamps, `${Model.modelName} must have timestamps enabled`);
      assert.ok(Model.schema.options.toJSON.transform, `${Model.modelName} must define toJSON transform`);
    }
  });
});

