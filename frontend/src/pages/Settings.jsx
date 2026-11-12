import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Server,
  Cpu,
  Shield,
  CheckCircle2,
  KeyRound,
  Lock,
  Unlock,
  RefreshCw,
  ExternalLink,
  Database,
  Trash2,
  Unplug,
} from 'lucide-react';
import { Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { metaApi } from '../services/api';
import { useStudio, usePageTitle } from '../context/StudioContext';

export function Settings() {
  usePageTitle('Settings');
  const { identity, setIdentity, announce } = useStudio();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tenantId, setTenantId] = useState(identity.tenantId);
  const [userId, setUserId] = useState(identity.userId);
  const [saved, setSaved] = useState(false);

  // Meta Integration state (never stores plaintext tokens in browser persistence)
  const [metaState, setMetaState] = useState({
    loading: true,
    busy: false,
    error: null,
    notice: null,
    status: null,
    syncRuns: [],
  });
  const [tokenInput, setTokenInput] = useState('');
  const [connectionType, setConnectionType] = useState('system_user');
  const [includeWriteScopeOAuth, setIncludeWriteScopeOAuth] = useState(false);
  const [writeConfirmPhrase, setWriteConfirmPhrase] = useState('');

  const loadMetaStatus = useCallback(async (refresh = false) => {
    setMetaState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [statusRes, runsRes] = await Promise.all([
        metaApi.getStatus(refresh),
        metaApi.getSyncRuns(6),
      ]);
      setMetaState((prev) => ({
        ...prev,
        loading: false,
        status: statusRes.data,
        syncRuns: runsRes.data?.items || [],
      }));
    } catch (err) {
      setMetaState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to inspect Meta Marketing connection',
      }));
    }
  }, []);

  useEffect(() => {
    const connected = searchParams.get('meta_connected');
    const oauthErr = searchParams.get('meta_error');

    if (connected === '1') {
      setMetaState((prev) => ({
        ...prev,
        notice: 'Meta OAuth connection completed and encrypted securely on the backend.',
      }));
      announce('Meta OAuth connected');
      searchParams.delete('meta_connected');
      setSearchParams(searchParams, { replace: true });
    } else if (oauthErr) {
      setMetaState((prev) => ({ ...prev, error: oauthErr }));
      searchParams.delete('meta_error');
      setSearchParams(searchParams, { replace: true });
    }

    loadMetaStatus(false);
  }, [loadMetaStatus, searchParams, setSearchParams, announce]);

  const handleSaveIdentity = (e) => {
    e.preventDefault();
    setIdentity({ tenantId, userId });
    setSaved(true);
    announce(`Updated workspace context to tenant ${tenantId}`);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleConnectToken = async (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    const rawToken = tokenInput.trim();
    // Clear sensitive input from React state immediately before async request completes
    setTokenInput('');
    setMetaState((prev) => ({ ...prev, busy: true, error: null, notice: null }));

    try {
      await metaApi.connectToken({
        access_token: rawToken,
        connection_type: connectionType,
      });
      announce('Meta Marketing token encrypted and verified on backend');
      setMetaState((prev) => ({
        ...prev,
        busy: false,
        notice: 'Meta connection verified and token encrypted at rest on server.',
      }));
      await loadMetaStatus(false);
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    }
  };

  const handleStartOAuth = async () => {
    setMetaState((prev) => ({ ...prev, busy: true, error: null, notice: null }));
    try {
      const res = await metaApi.startOAuth(includeWriteScopeOAuth);
      const authUrl = res.data?.authUrl;
      if (authUrl) {
        window.location.assign(authUrl);
      }
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    }
  };

  const handleSelectAdAccount = async (adAccountId) => {
    setMetaState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      await metaApi.selectAdAccount(adAccountId);
      announce(`Selected primary Meta Ad Account ${adAccountId}`);
      await loadMetaStatus(false);
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    } finally {
      setMetaState((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleToggleWriteAuth = async (authorize) => {
    setMetaState((prev) => ({ ...prev, busy: true, error: null, notice: null }));
    try {
      await metaApi.authorizeWrite({
        authorize,
        confirmation_phrase: authorize ? writeConfirmPhrase : '',
      });
      setWriteConfirmPhrase('');
      announce(authorize ? 'Meta write authorization unlocked' : 'Meta write authorization locked');
      await loadMetaStatus(false);
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    } finally {
      setMetaState((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleDisconnectMeta = async () => {
    setMetaState((prev) => ({ ...prev, busy: true, error: null }));
    try {
      await metaApi.disconnect();
      announce('Disconnected Meta Marketing API credentials');
      await loadMetaStatus(false);
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    } finally {
      setMetaState((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleRunFixtureSync = async () => {
    setMetaState((prev) => ({ ...prev, busy: true, error: null, notice: null }));
    try {
      await metaApi.triggerFixtureSync({});
      setMetaState((prev) => ({
        ...prev,
        busy: false,
        notice: 'Isolated Meta test fixtures synced cleanly. Open Analytics to inspect.',
      }));
      await loadMetaStatus(false);
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    }
  };

  const handleClearFixtures = async () => {
    setMetaState((prev) => ({ ...prev, busy: true, error: null, notice: null }));
    try {
      await metaApi.clearFixtures();
      setMetaState((prev) => ({
        ...prev,
        busy: false,
        notice: 'Cleared isolated test fixture snapshots cleanly.',
      }));
      await loadMetaStatus(false);
    } catch (err) {
      setMetaState((prev) => ({ ...prev, busy: false, error: err.message }));
    }
  };

  const conn = metaState.status?.connection;
  const isConnected = Boolean(metaState.status?.connected && conn);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Studio &amp; Meta Integration Settings</h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure workspace ownership, manage server-side encrypted Meta Marketing API connections, and control write authorization gates.
        </p>
      </div>

      {/* Meta Marketing API Integration Card */}
      <Card>
        <CardHeader
          title="Meta Marketing API Connection"
          description={`Graph API ${metaState.status?.graphApiVersion || 'v27.0'} · Tokens are AES-256-GCM encrypted server-side and never exposed to browsers.`}
          action={
            isConnected ? (
              <Badge variant={conn.status === 'expired' ? 'error' : 'success'}>
                {conn.status} · ***{conn.tokenLast4}
              </Badge>
            ) : (
              <Badge variant="neutral">Not Connected</Badge>
            )
          }
        />

        {metaState.notice ? (
          <div role="status" className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {metaState.notice}
          </div>
        ) : null}

        {metaState.error ? (
          <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {metaState.error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Connection Lifecycle + OAuth / Server-Side Token Entry */}
          <div className="space-y-4">
            {isConnected ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">
                    {conn.metaUserName || conn.metaUserId || 'Connected Meta Portfolio'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RefreshCw}
                      disabled={metaState.busy}
                      onClick={() => loadMetaStatus(true)}
                    >
                      Verify Token
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Unplug}
                      disabled={metaState.busy}
                      onClick={handleDisconnectMeta}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                  <div>Type: {conn.connectionType}</div>
                  <div>Access Tier: {conn.accessTier}</div>
                  <div>
                    Expires:{' '}
                    {conn.daysUntilExpiry !== null && conn.daysUntilExpiry !== undefined
                      ? `${conn.daysUntilExpiry}d remaining`
                      : 'Never / System User'}
                  </div>
                  <div>Scopes: {(conn.scopes || []).join(', ') || 'ads_read'}</div>
                </div>

                {conn.connectedAdAccounts?.length > 0 ? (
                  <div className="pt-2 border-t border-slate-800/80">
                    <label
                      htmlFor="meta-primary-account"
                      className="block text-[11px] font-medium text-slate-300 mb-1"
                    >
                      Verified Primary Ad Account
                    </label>
                    <select
                      id="meta-primary-account"
                      value={conn.primaryAdAccountId || ''}
                      disabled={metaState.busy}
                      onChange={(e) => handleSelectAdAccount(e.target.value)}
                      className="studio-input text-xs font-mono"
                    >
                      {conn.connectedAdAccounts.map((acc) => (
                        <option key={acc.adAccountId} value={acc.adAccountId}>
                          {acc.name} ({acc.adAccountId} · {acc.currency} · {acc.timezoneName})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                    Option 1 — Meta OAuth 2.0 Dialog
                  </div>
                  <Badge variant={metaState.status?.appConfigured ? 'success' : 'neutral'}>
                    {metaState.status?.appConfigured ? 'App Configured' : 'Needs META_APP_ID'}
                  </Badge>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeWriteScopeOAuth}
                    onChange={(e) => setIncludeWriteScopeOAuth(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-500"
                  />
                  <span>Request ads_management write scope alongside ads_read</span>
                </label>
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={metaState.busy}
                    onClick={handleStartOAuth}
                  >
                    Authorize with Meta OAuth
                  </Button>
                </div>
              </div>
            )}

            <form
              onSubmit={handleConnectToken}
              className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3"
            >
              <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
                {isConnected ? 'Rotate Token / Switch System User' : 'Option 2 — Server-Side System User / User Token'}
              </div>

              <div>
                <label htmlFor="meta-token-input" className="block text-[11px] text-slate-400 mb-1">
                  Meta Access Token (sent once via POST, cleared immediately in UI)
                </label>
                <input
                  id="meta-token-input"
                  type="password"
                  autoComplete="off"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="EAA..."
                  className="studio-input font-mono text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  aria-label="Connection token type"
                  value={connectionType}
                  onChange={(e) => setConnectionType(e.target.value)}
                  className="studio-input text-xs w-auto py-1.5"
                >
                  <option value="system_user">Business System User Token</option>
                  <option value="oauth_user">Extendable User Token (60d)</option>
                </select>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!tokenInput.trim() || metaState.busy}
                >
                  Verify &amp; Encrypt Server-Side
                </Button>
              </div>
            </form>
          </div>

          {/* Right: Write Authorization Safety Gate & Isolated Sandbox Fixtures */}
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  {conn?.writeAuthorized ? (
                    <Unlock className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  )}
                  Explicit Meta Write Authorization Gate
                </div>
                <Badge variant={conn?.writeAuthorized ? 'warning' : 'success'}>
                  {conn?.writeAuthorized ? 'Writes Unlocked' : 'Read-Only Safe'}
                </Badge>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Publishing/pausing Meta ads or modifying campaign budgets stays blocked by default unless both the Meta token has <code className="text-slate-200">ads_management</code> scope and a user explicitly authorizes writes below.
              </p>

              {isConnected ? (
                conn.writeAuthorized ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Lock}
                    disabled={metaState.busy}
                    onClick={() => handleToggleWriteAuth(false)}
                  >
                    Lock Meta Writes Back to Read-Only
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <label htmlFor="meta-write-phrase" className="block text-[11px] text-slate-400">
                      Type <code className="text-amber-300">AUTHORIZE_META_WRITES</code> to confirm:
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="meta-write-phrase"
                        type="text"
                        value={writeConfirmPhrase}
                        onChange={(e) => setWriteConfirmPhrase(e.target.value)}
                        placeholder="AUTHORIZE_META_WRITES"
                        className="studio-input font-mono text-xs"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Unlock}
                        disabled={
                          metaState.busy ||
                          !conn.hasAdsManagement ||
                          writeConfirmPhrase !== 'AUTHORIZE_META_WRITES'
                        }
                        onClick={() => handleToggleWriteAuth(true)}
                      >
                        Authorize
                      </Button>
                    </div>
                    {!conn.hasAdsManagement ? (
                      <p className="text-[11px] text-amber-300">
                        Current token does not include ads_management scope; reconnect with write permissions to unlock.
                      </p>
                    ) : null}
                  </div>
                )
              ) : (
                <p className="text-[11px] text-slate-500">
                  Connect a Meta account first to inspect granted permissions.
                </p>
              )}
            </div>

            {/* Sandbox Fixtures */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-purple-400" aria-hidden="true" />
                  Isolated Test Fixtures Sandbox
                </span>
                <Badge variant="purple">Testing Only</Badge>
              </div>
              <p className="text-[11px] text-slate-400">
                Populate isolated Graph API v27.0-shaped test records marked <code className="text-slate-200">isTestFixture=true</code> for local UI verification without Meta ad credentials.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Database}
                  disabled={metaState.busy}
                  onClick={handleRunFixtureSync}
                >
                  Sync Isolated Fixtures
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  disabled={metaState.busy}
                  onClick={handleClearFixtures}
                >
                  Clear Fixtures
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Preserved Workspace Context + Architecture Topology */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title="Tenant &amp; Ownership Context"
            description="Sent as X-Tenant-ID and X-User-ID headers on all API requests."
          />
          <form onSubmit={handleSaveIdentity} className="space-y-4">
            <div>
              <label htmlFor="set-tenant" className="block text-xs font-medium text-slate-300 mb-1">
                Tenant ID
              </label>
              <input
                id="set-tenant"
                type="text"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="tenant_default"
                className="studio-input font-mono text-xs"
              />
            </div>

            <div>
              <label htmlFor="set-user" className="block text-xs font-medium text-slate-300 mb-1">
                User ObjectId (Optional)
              </label>
              <input
                id="set-user"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Default workspace user"
                className="studio-input font-mono text-xs"
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              {saved ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Saved workspace headers
                </span>
              ) : (
                <span />
              )}
              <Button type="submit" variant="primary" size="sm">
                Save Context
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Service Architecture"
            description="Three-service AdPilot AI integration topology"
            action={<Badge variant="purple">Monorepo</Badge>}
          />
          <div className="space-y-3 text-xs">
            <div className="flex items-start gap-2.5 py-2 border-b border-slate-800/80">
              <Server className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 flex justify-between gap-2">
                <span className="text-slate-400">Backend API Proxy</span>
                <span className="font-mono text-slate-200">/api/* → :5000</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 py-2 border-b border-slate-800/80">
              <Cpu className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 flex justify-between gap-2">
                <span className="text-slate-400">Python Gemini Agent</span>
                <span className="font-mono text-slate-200">AGENT_SERVICE_URL (:8000)</span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 py-2">
              <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-slate-300">
                SSRF URL validation, private MinIO object proxy streaming, AES-256-GCM Meta token storage, and tenant ownership isolation active.
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
