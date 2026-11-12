import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MetaGraphClient } from '../src/integrations/meta/metaClient.js';
import {
  encryptToken,
  decryptToken,
  computeAppSecretProof,
  getTokenLast4,
} from '../src/integrations/meta/metaCrypto.js';
import {
  parseMetaRateLimitHeaders,
  classifyMetaApiError,
} from '../src/integrations/meta/metaRateLimiter.js';
import {
  parseMetaInsightRow,
  isWithinDelayedAttributionWindow,
  buildMetaSyncKey,
} from '../src/integrations/meta/metaMetricsParser.js';
import { buildIsolatedMetaFixtures } from '../src/integrations/meta/metaFixtures.js';
import { MetaRepository } from '../src/repositories/metaRepository.js';
import { CampaignRepository } from '../src/repositories/campaignRepository.js';
import { CreativeRepository } from '../src/repositories/creativeRepository.js';
import { MetaAuthService } from '../src/services/metaAuthService.js';
import { closeRedis } from '../src/queue/redisClient.js';
import { disconnectDatabase } from '../src/database/connection.js';

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async text() {
      return JSON.stringify(payload);
    },
  };
}

describe('Step 11 — Meta Marketing API Integration & Campaign Analytics', () => {
  const app = createApp();

  beforeEach(() => {
    MetaRepository.clearMemoryStore();
    CampaignRepository.clearMemoryStore();
    CreativeRepository.clearMemoryStore();
    MetaAuthService.clearOAuthStates();
    app.set('metaGraphClient', null);
  });

  after(async () => {
    await closeRedis();
    await disconnectDatabase();
  });

  test('Meta Crypto encrypts/decrypts tokens with AES-256-GCM and computes appsecret_proof', () => {
    const rawToken = 'EAAGm0PX4ZCpsBA_sample_secret_token_9911';
    const envelope = encryptToken(rawToken);
    assert.strictEqual(envelope.alg, 'aes-256-gcm');
    assert.notStrictEqual(envelope.ciphertext, rawToken);
    assert.strictEqual(decryptToken(envelope), rawToken);
    assert.strictEqual(getTokenLast4(rawToken), '9911');

    const proof = computeAppSecretProof(rawToken, 'my_app_secret_123');
    assert.match(proof, /^[0-9a-f]{64}$/);
  });

  test('Meta Rate Limit headers & Graph API error classification handle 429/190/200 accurately', () => {
    const rate = parseMetaRateLimitHeaders({
      'x-business-use-case-usage': JSON.stringify({
        act_1234: [{ call_count: 64, total_cputime: 40, total_time: 82, estimated_time_to_regain_access: 120 }],
      }),
      'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: 55 }),
    });
    assert.strictEqual(rate.maxUsagePct, 82);
    assert.strictEqual(rate.estimatedRegainSeconds, 120);

    const authErr = classifyMetaApiError(400, { error: { code: 190, message: 'Session expired' } });
    assert.strictEqual(authErr.statusCode, 401);

    const permErr = classifyMetaApiError(403, { error: { code: 200, message: 'Missing ads_management' } });
    assert.strictEqual(permErr.statusCode, 403);

    const throttleErr = classifyMetaApiError(
      400,
      { error: { code: 80004, message: 'Too many calls' } },
      rate
    );
    assert.strictEqual(throttleErr.statusCode, 429);
  });

  test('Meta Metrics Parser separates link clicks/CTR from all-click metrics and keeps missing metrics null', () => {
    const row = {
      account_id: '9988776655',
      campaign_id: 'camp_1',
      campaign_name: 'Lifelong Winter Sale',
      adset_id: 'adset_1',
      adset_name: 'Reels Broad',
      ad_id: 'ad_101',
      ad_name: 'Hook 1 Video [adpilot_creative:cr_hero_1]',
      date_start: '2026-10-01',
      date_stop: '2026-10-01',
      impressions: '10000',
      reach: '8400',
      spend: '1250.50',
      cpm: '125.05',
      clicks: '310',
      ctr: '3.10',
      cpc: '4.03',
      inline_link_clicks: '180',
      inline_link_click_ctr: '1.80',
      cost_per_inline_link_click: '6.95',
      actions: [
        { action_type: 'landing_page_view', value: '140' },
        { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '24' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '9' },
      ],
      action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '6252.50' }],
      purchase_roas: [{ action_type: 'omni_purchase', value: '5.00' }],
      attribution_setting: '7d_click_1d_view',
    };

    const parsed = parseMetaInsightRow(
      row,
      { currency: 'INR', timezoneName: 'Asia/Kolkata' },
      { referenceDate: new Date('2026-10-15T00:00:00Z') }
    );

    assert.strictEqual(parsed.allClicks, 310);
    assert.strictEqual(parsed.allClickCtr, 3.1);
    assert.strictEqual(parsed.linkClicks, 180);
    assert.strictEqual(parsed.linkCtr, 1.8);
    assert.strictEqual(parsed.cpc, 6.95);
    assert.strictEqual(parsed.landingPageViews, 140);
    assert.strictEqual(parsed.addToCart, 24);
    assert.strictEqual(parsed.purchases, 9);
    assert.strictEqual(parsed.purchaseConversionValue, 6252.5);
    assert.strictEqual(parsed.roas, 5);
    assert.strictEqual(parsed.currency, 'INR');
    assert.strictEqual(parsed.timezoneName, 'Asia/Kolkata');
    assert.strictEqual(parsed.isProvisionalAttribution, false);
    assert.strictEqual(parsed.missingMetrics.length, 0);

    // Missing pixel purchase row keeps missing fields null instead of fabricating zero
    const sparseRow = parseMetaInsightRow(
      {
        ad_id: 'ad_sparse',
        date_start: '2026-10-14',
        date_stop: '2026-10-14',
        impressions: '2000',
        spend: '400',
        inline_link_clicks: '40',
      },
      { currency: 'INR', timezoneName: 'Asia/Kolkata' },
      { referenceDate: new Date('2026-10-15T00:00:00Z') }
    );
    assert.strictEqual(sparseRow.purchases, null);
    assert.strictEqual(sparseRow.purchaseConversionValue, null);
    assert.strictEqual(sparseRow.roas, null);
    assert.strictEqual(sparseRow.reach, null);
    assert.strictEqual(sparseRow.isProvisionalAttribution, true);
    assert.ok(sparseRow.missingMetrics.includes('purchases'));
    assert.ok(sparseRow.missingMetrics.includes('reach'));

    assert.strictEqual(isWithinDelayedAttributionWindow('2026-10-14', new Date('2026-10-15T00:00:00Z')), true);
    assert.notStrictEqual(
      buildMetaSyncKey({ metaAdAccountId: 'act_1', metaAdId: 'ad_1', dateStart: '2026-10-14', breakdownKey: 'none' }),
      buildMetaSyncKey({ metaAdAccountId: 'act_1', metaAdId: 'ad_1', dateStart: '2026-10-14', breakdownKey: 'platform=instagram' })
    );
  });

  test('MetaGraphClient handles cursor pagination and automatic 429 retry', async () => {
    let callCount = 0;
    const mockFetch = async (urlStr) => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse(
          { error: { code: 17, message: 'User request limit reached' } },
          429,
          { 'x-business-use-case-usage': JSON.stringify({ act_1: [{ call_count: 95 }] }) }
        );
      }
      if (callCount === 2) {
        return jsonResponse({
          data: [{ id: 'camp_1', name: 'Page 1' }],
          paging: {
            cursors: { after: 'cursor_p2' },
            next: 'https://graph.facebook.com/v27.0/act_1/campaigns?after=cursor_p2',
          },
        });
      }
      assert.ok(urlStr.includes('after=cursor_p2'));
      return jsonResponse({
        data: [{ id: 'camp_2', name: 'Page 2' }],
      });
    };

    const client = new MetaGraphClient({ fetchImpl: mockFetch });
    const res = await client.getCampaigns({ accessToken: 'test_token_123456', adAccountId: 'act_1' });
    assert.strictEqual(res.items.length, 2);
    assert.strictEqual(res.pagesFetched, 2);
    assert.strictEqual(callCount, 3);
  });

  test('Full Express API flow: connect token (redacted), idempotent sync, creative mapping, analytics, and write authorization guard', async () => {
    const campaign = await CampaignRepository.create({
      tenantId: 'tenant_default',
      name: 'AeroFit Launch Campaign',
      product_url: 'https://www.lifelongindiaonline.com/products/aerofit',
      user_prompt: 'Target urban home fitness buyers on Instagram Reels',
      status: 'READY_FOR_REVIEW',
    });
    const creative = await CreativeRepository.createCreative({
      tenantId: 'tenant_default',
      campaignId: campaign.id,
      creativeKey: 'cr_hero_reels_01',
      format: 'image',
      placement: 'instagram_reels',
      title: 'AeroFit Copper Motor Hero Visual',
      evaluation: { overall_weighted_score: 91, verdict: 'APPROVED' },
    });

    const fixtureData = buildIsolatedMetaFixtures({
      adAccountId: 'act_55443322',
      currency: 'INR',
      timezoneName: 'Asia/Kolkata',
    });
    // Tag first fixture ad deterministically to our AdPilot creative
    fixtureData.ads[0].name = `AeroFit Ad [adpilot_creative:${creative.creativeKey}]`;
    const uploadedAd = fixtureData.ads[2];
    const externalAd = fixtureData.ads[3];

    const writeCalls = [];
    const mockClient = {
      async exchangeLongLivedToken({ shortLivedToken }) {
        return { accessToken: `long_${shortLivedToken}`, expiresIn: 5184000 };
      },
      async debugToken() {
        return {
          is_valid: true,
          type: 'SYSTEM_USER',
          user_id: 'meta_sys_user_1',
          user_name: 'AdPilot Integration Bot',
          scopes: ['ads_read', 'ads_management'],
          expires_at: Math.floor(Date.now() / 1000) + 5184000,
        };
      },
      async getAdAccounts() {
        return {
          items: [
            {
              id: 'act_55443322',
              account_id: '55443322',
              name: 'Lifelong India Performance',
              currency: 'INR',
              timezone_name: 'Asia/Kolkata',
              timezone_offset_hours_utc: 5.5,
              account_status: 1,
            },
          ],
          rateInfo: { maxUsagePct: 12 },
        };
      },
      async getCampaigns() {
        return { items: fixtureData.campaigns, rateInfo: { maxUsagePct: 14 } };
      },
      async getAds() {
        return { items: fixtureData.ads, rateInfo: { maxUsagePct: 16 } };
      },
      async getInsights({ breakdowns = [] }) {
        const isBreakdown = breakdowns.length > 0;
        const rows = (isBreakdown ? fixtureData.placementBreakdowns : fixtureData.dailyInsights).map((r) => ({
          ...r,
          account_id: '55443322',
        }));
        return { items: rows, rateInfo: { maxUsagePct: 21 } };
      },
      async updateAdEntity(args) {
        writeCalls.push(args);
        return { data: { success: true, id: args.entityId } };
      },
    };

    app.set('metaGraphClient', mockClient);

    // 1. Connect Meta token via POST and verify token secret never leaks back
    const secretToken = 'EAAB_SUPER_SECRET_META_TOKEN_7890';
    const connectRes = await request(app)
      .post('/api/meta/connect/token')
      .send({
        access_token: secretToken,
        connection_type: 'system_user',
      })
      .expect(200);

    const connJson = JSON.stringify(connectRes.body);
    assert.ok(!connJson.includes(secretToken));
    assert.ok(!connJson.includes('encryptedToken'));
    assert.strictEqual(connectRes.body.data.connection.tokenLast4, '7890');
    assert.strictEqual(connectRes.body.data.connection.primaryAdAccountId, 'act_55443322');
    assert.strictEqual(connectRes.body.data.connection.writeAuthorized, false);

    // 2. Sync twice to verify idempotency and rate limit recording
    const sync1 = await request(app)
      .post('/api/meta/sync')
      .send({ include_placement_breakdown: true })
      .expect(200);
    assert.strictEqual(sync1.body.data.syncRun.status, 'completed_with_warnings');
    assert.strictEqual(sync1.body.data.syncRun.rateLimitPeakPct, 21);

    await request(app).post('/api/meta/sync').send({ include_placement_breakdown: true }).expect(200);

    const overviewRes = await request(app).get('/api/analytics/overview').expect(200);
    const secondOverview = await request(app).get('/api/analytics/overview').expect(200);
    assert.strictEqual(
      overviewRes.body.data.totals.spend,
      secondOverview.body.data.totals.spend,
      'Idempotent re-sync must not double-count daily spend'
    );
    assert.strictEqual(overviewRes.body.data.dataQuality.primaryCurrency, 'INR');
    assert.ok(overviewRes.body.data.dataQuality.provisionalDates.length > 0);

    // 3. Creative comparison distinguishes AdPilot-generated vs External Meta ads, then manual map
    const creativeCompBefore = await request(app).get('/api/analytics/creatives').expect(200);
    const adpilotItem = creativeCompBefore.body.data.items.find(
      (i) => i.adPilotCreativeId === creative.id
    );
    assert.ok(adpilotItem, 'Tagged AdPilot creative auto-linked');
    assert.strictEqual(adpilotItem.origin, 'adpilot_generated');
    assert.strictEqual(adpilotItem.adPilotQaScore, 91);

    const uploadedItem = creativeCompBefore.body.data.items.find((i) => i.metaAdId === uploadedAd.id);
    assert.strictEqual(uploadedItem.origin, 'uploaded_creative');

    const externalItem = creativeCompBefore.body.data.items.find((i) => i.metaAdId === externalAd.id);
    assert.strictEqual(externalItem.origin, 'external_meta');

    // Re-map an uploaded creative manually & filter analytics by campaignId
    await request(app)
      .post('/api/meta/mappings')
      .send({
        meta_ad_account_id: 'act_55443322',
        meta_ad_id: uploadedAd.id,
        meta_ad_name: uploadedAd.name,
        adpilot_campaign_id: campaign.id,
        origin: 'uploaded_creative',
        creative_title: 'Studio Uploaded Carousel',
      })
      .expect(200);

    const filteredCampaignComp = await request(app)
      .get(`/api/analytics/creatives?campaignId=${campaign.id}`)
      .expect(200);
    assert.strictEqual(filteredCampaignComp.body.data.items.length, 2);

    const breakdownsRes = await request(app).get('/api/analytics/breakdowns').expect(200);
    assert.ok(breakdownsRes.body.data.placements.length > 0);

    const trendsRes = await request(app).get('/api/analytics/trends').expect(200);
    assert.ok(trendsRes.body.data.series.length > 0);

    // 4. Write authorization gate blocks without explicit enable + flag, succeeds when authorized
    await request(app)
      .post('/api/meta/actions/budget')
      .send({
        entity_id: fixtureData.campaigns[0].id,
        ad_account_id: 'act_55443322',
        daily_budget_minor_units: 250000,
        explicit_user_authorization: true,
      })
      .expect(403);

    await request(app)
      .post('/api/meta/authorize-write')
      .send({ authorize: true, confirmation_phrase: 'AUTHORIZE_META_WRITES' })
      .expect(200);

    await request(app)
      .post('/api/meta/actions/budget')
      .send({
        entity_id: fixtureData.campaigns[0].id,
        ad_account_id: 'act_55443322',
        daily_budget_minor_units: 250000,
        explicit_user_authorization: false,
      })
      .expect(400);

    const budgetWriteRes = await request(app)
      .post('/api/meta/actions/budget')
      .send({
        entity_id: fixtureData.campaigns[0].id,
        ad_account_id: 'act_55443322',
        daily_budget_minor_units: 250000,
        explicit_user_authorization: true,
      })
      .expect(200);
    assert.strictEqual(budgetWriteRes.body.data.dailyBudgetMinorUnits, 250000);
    assert.strictEqual(writeCalls.length, 1);
  });

  test('Isolated Meta test fixture sync is explicitly marked isTestFixture and removable without touching live records', async () => {
    const fxRes = await request(app).post('/api/meta/sync/fixtures').send({}).expect(200);
    assert.strictEqual(fxRes.body.data.syncRun.isTestFixture, true);

    const overviewWithFixtures = await request(app).get('/api/analytics/overview').expect(200);
    assert.strictEqual(overviewWithFixtures.body.data.containsTestFixtures, true);
    assert.ok(overviewWithFixtures.body.data.recordCount > 0);

    const overviewLiveOnly = await request(app)
      .get('/api/analytics/overview?includeTestFixtures=false')
      .expect(200);
    assert.strictEqual(overviewLiveOnly.body.data.recordCount, 0);

    await request(app).delete('/api/meta/fixtures').expect(200);
    const afterDelete = await request(app).get('/api/analytics/overview').expect(200);
    assert.strictEqual(afterDelete.body.data.recordCount, 0);
  });
});
