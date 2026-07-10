'use client';

import { useState, useEffect, useCallback } from 'react';
import { NavIcon } from '@/components/NavIcon';
import RazoterLogo from '@/components/RazoterLogo';
import {
  IconCopy, IconArchive, IconKey, IconCoin, IconSearch, IconCheck, IconCross,
  IconClock, IconFlask, IconPencil, IconTrash, IconSync, IconRoute, IconPlus,
  IconWarning, IconPlug, IconChart, IconSpinner, IconSpinnerLg,
} from '@/components/AppIcon';

// ─── Types ─────────────────────────────────────────

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeys: Array<{ name: string; key: string; enabled: boolean }>;
  models: string[];
  selectedModels: string[];
  apiKeyStrategy?: 'random' | 'failover-priority' | 'round-robin';
  priority: number;
  enabled: boolean;
  archived?: boolean;
  healthStatus: string;
  lastHealthCheck: string | null;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  rateLimitTotal: number | null;
  createdAt: string;
}

interface ApiKeyEntry {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt: string | null;
}

type ComboStrategy = 'failover-priority' | 'round-robin';

interface ComboItem {
  providerId: string;
  providerName: string;
  model: string;
  apiKeyName?: string;
}

interface Combo {
  id: string;
  name: string;
  items: ComboItem[];
  strategy: ComboStrategy;
  enabled: boolean;
  createdAt: string;
}

interface Quota {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
  apiKeyName: string;
  monthlyLimit: number;
  currentUsage: number;
  resetDay: number;
  createdAt: string;
}

interface RequestLog {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
  status: string;
  statusCode?: number;
  latencyMs: number;
  tokensUsed?: number;
  errorMessage?: string;
  apiKeyName?: string;
  createdAt: string;
}

interface Stats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  providerBreakdown: Array<{
    providerId: string;
    providerName: string;
    requests: number;
    successes: number;
    errors: number;
    avgLatency: number;
    totalTokens: number;
  }>;
}

// ─── Helpers ───────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('razoter_token');
}

function setToken(token: string) {
  localStorage.setItem('razoter_token', token);
}

function clearToken() {
  localStorage.removeItem('razoter_token');
  localStorage.removeItem('razoter_user');
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
      {copied ? <IconCheck size={14} className="text-emerald-600" /> : <IconCopy size={14} className="text-slate-400" />}
    </button>
  );
}

// ─── Main Component ────────────────────────────────

export default function Dashboard() {
  const [token, setTokenState] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);

  const [activeTab, setActiveTab] = useState<'providers' | 'combos' | 'logs' | 'settings'>('providers');
  const [showProviderModal, setShowProviderModal] = useState(false);

  // Token usage per provider (from stats breakdown)
  const tokenByProvider = (stats?.providerBreakdown ?? []).reduce<Record<string, number>>((acc, b) => {
    acc[b.providerId] = b.totalTokens;
    return acc;
  }, {});
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  // Provider form
  const [providerForm, setProviderForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [providerFormKeys, setProviderFormKeys] = useState<Array<{name: string, key: string}>>([{ name: 'Key 1', key: '' }]);
  const [providerFormStrategy, setProviderFormStrategy] = useState<'random' | 'failover-priority' | 'round-robin'>('random');
  const [providerType, setProviderType] = useState<'custom' | 'chatgpt_plus' | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // API key
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  // Show archived providers toggle
  const [showArchived, setShowArchived] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
  const [comboForm, setComboForm] = useState({ name: '', strategy: 'failover-priority' as ComboStrategy });
  const [comboItems, setComboItems] = useState<ComboItem[]>([]);

  // Model testing
  const [modelTestResults, setModelTestResults] = useState<Record<string, { status: 'idle' | 'testing' | 'ok' | 'fail'; latencyMs?: number; error?: string }>>({});
  const [testingAllModels, setTestingAllModels] = useState<string | null>(null); // providerId when testing all

  // Quota form
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [quotaForm, setQuotaForm] = useState({ providerId: '', monthlyLimit: 0, resetDay: 1 });

  // Log error modal
  const [selectedLogError, setSelectedLogError] = useState<RequestLog | null>(null);

  // ChatGPT Plus login flow
  const [chatgptStep, setChatgptStep] = useState<'idle' | 'code' | 'waiting' | 'done' | 'error'>('idle');
  const [chatgptUserCode, setChatgptUserCode] = useState('');
  const [chatgptDeviceId, setChatgptDeviceId] = useState('');
  const [chatgptError, setChatgptError] = useState('');

  // ─── API helper ──────────────────────────────
  const API_TIMEOUT_MS = 30000;
  const api = useCallback(async (url: string, options: RequestInit = {}, retry = 1) => {
    const t = token || getToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
          ...(options.headers || {}),
        },
      });
      if (res.status === 401) { clearTimeout(timeoutId); clearToken(); setTokenState(null); throw new Error('Unauthorized'); }
      return res;
    } catch (err: any) {
      // Retry once on network/timeout errors (but not on 401)
      if (retry > 0 && err?.name !== 'AbortError' && !(err instanceof DOMException && err.name === 'AbortError')) {
        clearTimeout(timeoutId);
        return api(url, options, retry - 1);
      }
      if (err?.name === 'AbortError') {
        clearTimeout(timeoutId);
        throw new Error('Network timeout — server terlalu lama merespons');
      }
      clearTimeout(timeoutId);
      throw new Error('Network error — periksa koneksi internet Anda');
    } finally {
      clearTimeout(timeoutId);
    }
  }, [token]);

  // ─── Data fetching ───────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const providersUrl = '/api/providers' + (showArchived ? '?archived=true' : '');
      const [provRes, logRes, statsRes, configRes, keysRes, combosRes] = await Promise.all([
        api(providersUrl),
        api('/api/logs?limit=50'),
        api('/api/stats'),
        api('/api/config'),
        api('/api/api-keys'),
        api('/api/combos'),
      ]);
      if (provRes.ok) {
        const provs = await provRes.json();
        provs.sort((a: any, b: any) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta; // terbaru dulu
        });
        setProviders(provs);
      }
      if (logRes.ok) { const d = await logRes.json(); setLogs(d.logs || d); }
      if (statsRes.ok) setStats(await statsRes.json());
      if (configRes.ok) { const c = await configRes.json(); setConfig(c); }
      if (keysRes.ok) setApiKeys(await keysRes.json());
      if (combosRes.ok) setCombos(await combosRes.json());
    } catch (e) { console.error('Fetch error:', e); }
  }, [api]);

  useEffect(() => {
    const t = getToken();
    if (t) { setTokenState(t); fetchData(); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    // Skip polling while tab is hidden to save network/Supabase load.
    if (document.hidden) return;
    fetchData();
    const interval = setInterval(fetchData, 30000);
    const onVisibility = () => {
      if (!document.hidden) fetchData(); // refresh once when returning to tab
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, fetchData]);

  // ─── Auto-sync quotas with providers ───────────
  // Silently create quota cards for any provider+apiKeyName combos missing
  useEffect(() => {
    if (!providers.length || !quotas.length) return;
    const asyncSync = async () => {
      try {
        let created = 0;
        for (const provider of providers) {
          if (!provider.enabled) continue;
          const keys = provider.apiKeys || [{ name: 'Default', key: provider.apiKey, enabled: true }];
          for (const ak of keys) {
            if (!ak.enabled) continue;
            const hasQuota = quotas.some(q => q.providerId === provider.id && q.apiKeyName === ak.name);
            if (!hasQuota) {
              await api('/api/quotas', {
                method: 'POST',
                body: JSON.stringify({ providerId: provider.id, providerName: provider.name, model: '', monthlyLimit: 0, resetDay: 1, apiKeyName: ak.name }),
              });
              created++;
            }
          }
        }
        if (created > 0) {
          const msg = '[Auto-sync] Created ' + created + ' missing quota card(s)';
          console.log(msg);
          fetchData();
        }
      } catch (e) {
        console.error('[Auto-sync] Error syncing quotas:', e);
      }
    };
    asyncSync();
  }, [providers, quotas, api, fetchData]);

  // ─── Auth ────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || 'Login failed'); return; }
      setToken(data.token);
      setTokenState(data.token);
    } catch { setLoginError('Network error'); }
  }

  function handleLogout() { clearToken(); setTokenState(null); }

  // ─── Provider actions ────────────────────────────

  async function handleAutoCreateQuotas(providerId: string, providerName: string, keys: Array<{name: string, key: string}>) {
    try {
      for (const ak of keys) {
        if (!ak.key) continue;
        await api('/api/quotas', {
          method: 'POST',
          body: JSON.stringify({ providerId, providerName, model: '', monthlyLimit: 0, resetDay: 1, apiKeyName: ak.name }),
        });
      }
      fetchData();
    } catch (e) { console.error('Auto-create quotas error:', e); }
  }

  async function handleTestConnection() {
    if (!providerForm.baseUrl) return;
    // Send ALL keys (in order) so each is tested individually.
    const testBody: Record<string, unknown> = { baseUrl: providerForm.baseUrl };
    const keysToTest = providerFormKeys.filter(k => k.key && !k.key.includes('...'));
    if (keysToTest.length > 0) {
      testBody.apiKeys = keysToTest.map(k => ({ name: k.name, key: k.key }));
    } else if (editingProvider) {
      // No new key typed — let backend use the stored keys for this provider
      testBody.providerId = editingProvider.id;
    } else {
      return; // New provider needs a key
    }
    setTestingConnection(true); setTestResult(null); setDiscoveredModels([]); setSelectedModels([]);
    try {
      const res = await api('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify(testBody),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success && data.models) {
        setDiscoveredModels(data.models);
        if (editingProvider) {
          const existing = editingProvider.selectedModels.filter(m => data.models.includes(m));
          setSelectedModels(existing.length > 0 ? existing : data.models);
        } else { setSelectedModels(data.models); }
      }
    } catch { setTestResult({ success: false, error: 'Network error' }); }
    finally { setTestingConnection(false); }
  }

  function toggleModel(model: string) {
    setSelectedModels(prev => prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]);
  }

  async function handleSaveProvider() {
    if (!providerForm.name || !providerForm.baseUrl) return;
    // New provider needs at least one key with a value
    const validNewKeys = providerFormKeys.filter(k => k.key && !k.key.startsWith('•'));
    if (!editingProvider && validNewKeys.length === 0) { alert('Masukkan minimal 1 API key!'); return; }
    if (discoveredModels.length === 0) { alert('Test connection dulu untuk discover models!'); return; }
    if (selectedModels.length === 0) { alert('Pilih minimal 1 model!'); return; }
    try {
      const body: Record<string, unknown> = { name: providerForm.name, baseUrl: providerForm.baseUrl, models: discoveredModels, selectedModels, priority: 10, enabled: true };
      // Build apiKeys array — send the FULL providerFormKeys in current order.
      // Order + names are authoritative; backend fills any empty/masked value
      // from the existing stored key (matched by name).
      const apiKeysPayload: Array<{ name: string; key: string; enabled: boolean }> = [];
      if (editingProvider && editingProvider.apiKeys && editingProvider.apiKeys.length > 0) {
        for (let i = 0; i < providerFormKeys.length; i++) {
          const fk = providerFormKeys[i];
          if (!fk || !fk.name) continue;
          // existing keys keep their stored enabled flag unless user toggled — we mirror form
          apiKeysPayload.push({
            name: fk.name,
            key: fk.key, // full value (edit form is pre-filled), or '' if cleared
            enabled: true,
          });
        }
        // include any extra new keys appended beyond the original count
        for (let i = providerFormKeys.length; i < providerFormKeys.length; i++) {
          if (providerFormKeys[i].key && !providerFormKeys[i].key.includes('...')) {
            apiKeysPayload.push({ name: providerFormKeys[i].name, key: providerFormKeys[i].key, enabled: true });
          }
        }
      } else {
        // New provider — all form keys are new
        for (const fk of providerFormKeys) {
          if (fk.key) apiKeysPayload.push({ name: fk.name, key: fk.key, enabled: true });
        }
      }
      if (apiKeysPayload.length > 0) body.apiKeys = apiKeysPayload;
      body.apiKeyStrategy = providerFormStrategy;
      // Backward compat: first real (non-masked) key
      const firstRealKey = validNewKeys.length > 0 ? validNewKeys[0].key : '';
      if (firstRealKey) body.apiKey = firstRealKey;
      const res = editingProvider
        ? await api('/api/providers', { method: 'PUT', body: JSON.stringify({ id: editingProvider.id, ...body }) })
        : await api('/api/providers', { method: 'POST', body: JSON.stringify({ ...body, apiKey: firstRealKey }) });
      if (res.ok) {
        const data = await res.json();
        setShowProviderModal(false); resetProviderForm(); fetchData();
        if (!editingProvider && data.id) {
          handleAutoCreateQuotas(data.id, providerForm.name, providerFormKeys);
        }
      }
      else { const err = await res.json(); alert(err.error || 'Failed'); }
    } catch { alert('Network error'); }
  }

  async function handleDeleteProvider(id: string) {
    if (!confirm('Hapus provider ini?')) return;
    const url = `/api/providers?id=${id}`;
    try { await api(url, { method: 'DELETE' }); fetchData(); } catch {}
  }

  async function handleArchiveProvider(provider: Provider) {
    const action = provider.archived ? 'tampilkan kembali' : 'arsipkan';
    if (!confirm(`Yakin ingin ${action} provider "${provider.name}"?`)) return;
    const archiveUrl = `/api/providers?id=${provider.id}&action=archive&archived=${!provider.archived}`;
    try {
      await api(archiveUrl, { method: 'DELETE' });
      fetchData();
    } catch {}
  }

  async function handleToggleProvider(provider: Provider) {
    try { await api('/api/providers', { method: 'PUT', body: JSON.stringify({ id: provider.id, enabled: !provider.enabled }) }); fetchData(); } catch {}
  }

  function openEditModal(provider: Provider) {
    setEditingProvider(provider);
    setProviderForm({ name: provider.name, baseUrl: provider.baseUrl, apiKey: '' });
    const existingKeys = (provider.apiKeys && provider.apiKeys.length > 0)
      ? provider.apiKeys.map(k => ({ name: k.name, key: k.key }))
      : [{ name: 'Key 1', key: '' }];
    setProviderFormKeys(existingKeys);
    setProviderFormStrategy(provider.apiKeyStrategy || 'random');
    setDiscoveredModels(provider.models);
    setSelectedModels(provider.selectedModels);
    setTestResult(null);
    setShowProviderModal(true);
  }

  function resetProviderForm() {
    setProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setProviderFormKeys([{ name: 'Key 1', key: '' }]);
    setDiscoveredModels([]); setSelectedModels([]); setModelSearch(''); setTestResult(null); setEditingProvider(null);
    setProviderType(null);
    setChatgptStep('idle'); setChatgptUserCode(''); setChatgptDeviceId(''); setChatgptError('');
  }

  // ─── ChatGPT Plus login flow ─────────────────────

  async function handleChatgptStart() {
    setChatgptStep('waiting');
    setChatgptError('');
    try {
      const res = await api('/api/auth/chatgpt/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setChatgptStep('error'); setChatgptError(data.error || 'Failed to start login'); return; }
      setChatgptUserCode(data.user_code);
      setChatgptDeviceId(data.device_auth_id);
      setChatgptStep('code');
      // Auto-poll every 5 seconds
      startChatgptPoll(data.device_auth_id, data.user_code);
    } catch (err: any) {
      setChatgptStep('error');
      setChatgptError(err.message || 'Network error');
    }
  }

  function startChatgptPoll(deviceAuthId: string, userCode: string) {
    const pollInterval = setInterval(async () => {
      try {
        const res = await api('/api/auth/chatgpt/poll', {
          method: 'POST',
          body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
        });
        const data = await res.json();
        if (data.status === 'success') {
          clearInterval(pollInterval);
          setChatgptStep('done');
          setShowProviderModal(false);
          resetProviderForm();
          fetchData();
        } else if (data.status === 'pending') {
          // Still waiting, continue polling
        } else {
          clearInterval(pollInterval);
          setChatgptStep('error');
          setChatgptError(data.error || 'Login failed');
        }
      } catch {
        // Network error during poll, keep trying
      }
    }, 5000);
    // Clear after 10 minutes
    setTimeout(() => clearInterval(pollInterval), 600000);
  }

  // ─── API Key actions ─────────────────────────────

  async function handleGenerateApiKey() {
    if (!newKeyName.trim()) return;
    try {
      const res = await api('/api/api-keys', { method: 'POST', body: JSON.stringify({ name: newKeyName.trim() }) });
      if (res.ok) {
        const data = await res.json();
        setGeneratedKey(data.key);
        setNewKeyName('');
        fetchData();
      }
    } catch {}
  }

  async function handleDeleteApiKey(id: string) {
    if (!confirm('Hapus API key ini?')) return;
    const url = `/api/api-keys?id=${id}`;
    try { await api(url, { method: 'DELETE' }); fetchData(); } catch {}
  }

  // ─── Combo actions ───────────────────────────────

  function openComboModal() {
    setComboForm({ name: '', strategy: 'failover-priority' });
    setComboItems([]);
    setEditingCombo(null);
    setShowComboModal(true);
  }

  function openEditComboModal(combo: Combo) {
    setEditingCombo(combo);
    setComboForm({ name: combo.name, strategy: combo.strategy || 'failover-priority' });
    setComboItems([...combo.items]);
    setShowComboModal(true);
  }

  function addComboItem() {
    setComboItems(prev => [...prev, { providerId: '', providerName: '', model: '' }]);
  }

  function updateComboItem(index: number, field: string, value: string) {
    setComboItems(prev => {
      const updated = [...prev];
      if (field === 'providerId') {
        const provider = providers.find(p => p.id === value);
        updated[index] = { ...updated[index], providerId: value, providerName: provider?.name || '', model: '', apiKeyName: '' };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  }

  function removeComboItem(index: number) {
    setComboItems(prev => prev.filter((_, i) => i !== index));
  }

  function moveComboItem(index: number, direction: 'up' | 'down') {
    setComboItems(prev => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      const updated = [...prev];
      [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
      return updated;
    });
  }

  async function handleSaveCombo() {
    if (!comboForm.name.trim()) { alert('Nama combo wajib diisi!'); return; }
    if (comboItems.length === 0) { alert('Tambah minimal 1 model!'); return; }
    if (comboItems.some(item => !item.providerId || !item.model)) { alert('Isi semua field!'); return; }
    try {
      if (editingCombo) {
        const res = await api('/api/combos', {
          method: 'PUT',
          body: JSON.stringify({ id: editingCombo.id, name: comboForm.name.trim(), items: comboItems, strategy: comboForm.strategy }),
        });
        if (res.ok) { setShowComboModal(false); fetchData(); }
        else { const err = await res.json(); alert(err.error || 'Failed'); }
      } else {
        const res = await api('/api/combos', {
          method: 'POST',
          body: JSON.stringify({ name: comboForm.name.trim(), items: comboItems, strategy: comboForm.strategy }),
        });
        if (res.ok) { setShowComboModal(false); fetchData(); }
        else { const err = await res.json(); alert(err.error || 'Failed'); }
      }
    } catch { alert('Network error'); }
  }

  async function handleDeleteCombo(id: string) {
    if (!confirm('Hapus combo ini?')) return;
    const url = `/api/combos?id=${id}`;
    try { await api(url, { method: 'DELETE' }); fetchData(); } catch {}
  }

  async function handleToggleCombo(combo: Combo) {
    try { await api('/api/combos', { method: 'PUT', body: JSON.stringify({ id: combo.id, enabled: !combo.enabled }) }); fetchData(); } catch {}
  }

  // ─── Quota actions ───────────────────────────────

  async function handleTestSingleModel(provider: Provider, model: string, apiKey?: string, apiKeyName?: string) {
    const key = `${provider.id}:${apiKeyName ?? 'default'}:${model}`;
    setModelTestResults(prev => ({ ...prev, [key]: { status: 'testing' } }));
    try {
      const res = await api('/api/providers/test-model', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: provider.baseUrl, providerId: provider.id, model, apiKey, apiKeyName }),
      });
      const data = await res.json();
      setModelTestResults(prev => ({
        ...prev,
        [key]: data.success
          ? { status: 'ok', latencyMs: data.latencyMs }
          : { status: 'fail', error: data.error, latencyMs: data.latencyMs },
      }));
    } catch {
      setModelTestResults(prev => ({ ...prev, [key]: { status: 'fail', error: 'Network error' } }));
    }
  }

  async function handleTestAllModels(provider: Provider) {
    setTestingAllModels(provider.id);
    setModelTestResults({});
    const models = provider.selectedModels.length > 0 ? provider.selectedModels : provider.models;
    // Determine the list of keys to test (respect multi-key order; single key falls back to main apiKey)
    const keys: Array<{ name: string; key?: string }> = [];
    if (provider.apiKeys && provider.apiKeys.length > 0) {
      for (const k of provider.apiKeys) {
        if (k.enabled !== false) keys.push({ name: k.name, key: k.key });
      }
    }
    if (keys.length === 0) keys.push({ name: 'Default', key: provider.apiKey });
    for (const k of keys) {
      for (const model of models) {
        await handleTestSingleModel(provider, model, k.key, k.name);
      }
    }
    setTestingAllModels(null);
  }

  function openQuotaModal() {
    setQuotaForm({ providerId: '', monthlyLimit: 0, resetDay: 1 });
    setShowQuotaModal(true);
  }

  async function handleSaveQuota() {
    if (!quotaForm.providerId) { alert('Pilih provider!'); return; }
    const provider = providers.find(p => p.id === quotaForm.providerId);
    if (!provider) return;
    try {
      const res = await api('/api/quotas', {
        method: 'POST',
        body: JSON.stringify({ providerId: quotaForm.providerId, providerName: provider.name, model: '', monthlyLimit: quotaForm.monthlyLimit, resetDay: quotaForm.resetDay }),
      });
      if (res.ok) { setShowQuotaModal(false); fetchData(); }
      else { const err = await res.json(); alert(err.error || 'Failed'); }
    } catch { alert('Network error'); }
  }

  async function handleDeleteQuota(id: string) {
    if (!confirm('Hapus quota ini?')) return;
    const url = `/api/quotas?id=${id}`;
    try { await api(url, { method: 'DELETE' }); fetchData(); } catch {}
  }

  function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return String(tokens);
  }

  // ─── Settings ────────────────────────────────────

  async function handleChangeMode(mode: string) {
    try { await api('/api/config', { method: 'PUT', body: JSON.stringify({ mode }) }); fetchData(); } catch {}
  }

  async function handleClearLogs() {
    if (!confirm('Hapus semua logs?')) return;
    try { await api('/api/logs', { method: 'DELETE' }); fetchData(); } catch {}
  }

  // ─── UI helpers ──────────────────────────────────

  function statusBadge(status: string) {
    const colors: Record<string, string> = { success: 'bg-emerald-100 text-emerald-700', error: 'bg-red-100 text-red-700', timeout: 'bg-amber-100 text-amber-700', retry: 'bg-blue-100 text-blue-700' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-slate-100 text-slate-500'}`}>{status}</span>;
  }

  function formatTime(ts: string) { return new Date(ts).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function formatLatency(ms: number) { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`; }

  const BASE_URL = 'https://razoter.vercel.app/api/v1';

  // ─── Login screen ──────────────────────────────

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: 'radial-gradient(900px 600px at 50% 20%, rgba(0,191,255,0.10), transparent 60%), linear-gradient(180deg,#050B18,#081426)' }}><div className="pulse-dot text-cyan-400"><IconSpinnerLg size={36} className="text-cyan-400" /></div></div>;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'radial-gradient(900px 600px at 50% 20%, rgba(0,191,255,0.12), transparent 60%), radial-gradient(800px 500px at 110% 90%, rgba(53,230,255,0.08), transparent 60%), linear-gradient(180deg,#050B18,#081426)' }}>
        <form onSubmit={handleLogin} className="card w-full max-w-sm space-y-4" style={{ animation: 'fade-in 0.4s ease both' }}>
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#06b6d4)', boxShadow: '0 8px 24px -6px rgba(99,102,241,0.5)' }}><RazoterLogo size={32} /></div>
            <h1 className="text-2xl font-bold text-slate-900">Razoter</h1>
            <p className="text-sm text-slate-500 mt-1">Dashboard Login</p>
          </div>
          {loginError && <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm">{loginError}</div>}
          <input type="text" placeholder="Username" className="input" value={loginForm.username} onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))} />
          <input type="password" placeholder="Password" className="input" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} />
          <button type="submit" className="btn btn-primary w-full">Login</button>
        </form>
      </div>
    );
  }

  // ─── Dashboard ───────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 700px at 12% -10%, rgba(0,191,255,0.10), transparent 58%), radial-gradient(1000px 600px at 110% 6%, rgba(53,230,255,0.08), transparent 58%), radial-gradient(900px 700px at 50% 120%, rgba(0,153,204,0.07), transparent 60%), linear-gradient(180deg,#050B18 0%,#081426 100%)' }}>
      <header className="app-header sticky top-0 z-40 border-b">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4">
          <div className="flex items-center gap-[13px]">
            <RazoterLogo size={42} />
            <div className="flex items-baseline gap-2">
              <h1 className="text-[23px] sm:text-[24px] font-bold text-slate-900 tracking-tight leading-none">Razoter</h1>
              <span className="text-[13px] text-slate-400 font-medium leading-none">v2.2</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleLogout} className="text-[14px] font-medium text-slate-500 hover:text-red-600 transition-colors">Logout</button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Tabs */}
        <div className="tab-bar flex gap-1 rounded-lg p-1 overflow-x-auto flex-nowrap justify-center sm:justify-start">
          {(['providers', 'combos', 'logs', 'settings'] as const).map(tab => (
            <button key={tab} aria-label={tab === 'providers' ? 'Providers' : tab === 'combos' ? 'Gabung' : tab === 'settings' ? 'Dokumentasi' : 'Logs'} onClick={() => setActiveTab(tab)} className={`flex-1 sm:flex-none min-w-[3rem] px-3 sm:px-4 py-2.5 sm:py-2 rounded-md text-[15px] sm:text-[16px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${activeTab === tab ? 'tab-active shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <NavIcon name={tab} active={activeTab === tab} size={19} />
              <span className="hidden sm:inline">{tab === 'providers' ? 'Providers' : tab === 'combos' ? 'Gabung' : tab === 'settings' ? 'Dokumentasi' : 'Logs'}</span>
            </button>
          ))}
        </div>

        {/* ─── Providers Tab ──────────────────────── */}
        {activeTab === 'providers' && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
              <h2 className="text-[23px] font-bold text-slate-900 tracking-tight">Providers</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <button onClick={() => setShowArchived(s => !s)} className={`flex-1 sm:flex-none text-[13px] px-3 py-2.5 rounded-lg font-medium whitespace-nowrap flex items-center justify-center gap-1.5 ${showArchived ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}><IconArchive size={14} />{showArchived ? 'Sembunyikan Arsip' : 'Tampilkan Arsip'}</button>
                <button onClick={() => { resetProviderForm(); setShowProviderModal(true); }} className="btn btn-primary flex-1 sm:flex-none text-[13.5px] justify-center">+ Add Provider</button>
              </div>
            </div>
            {providers.length === 0 ? (
              <div className="card text-center py-12 text-slate-400"><div className="text-4xl mb-2">🔌</div><p>Belum ada provider. Tambah provider pertama!</p></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {providers.map(p => (
                  <div key={p.id} className="card flex flex-col p-3 min-h-[264px]">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-yellow-500 text-[15px] leading-snug truncate flex-1">{p.name}</h3>
                      <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${p.enabled ? 'bg-emerald-100 text-emerald-700 status-on' : 'bg-slate-200 text-slate-500'}`}>{p.enabled ? 'ON' : 'OFF'}</span>
                      <button onClick={() => handleArchiveProvider(p)} className="text-[11px] px-1.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 inline-flex items-center gap-1" title={p.archived ? 'Buka dari arsip' : 'Arsip'}>{p.archived ? 'Buka' : <><IconArchive size={12} /> Arsip</>}</button>
                    </div>
                    <div className="text-[13px] text-slate-400 mt-1.5 font-mono truncate leading-relaxed" title={p.baseUrl}>{p.baseUrl}</div>
                    <div className="flex items-center gap-3 mt-1.5 text-[12.5px] text-slate-500 leading-relaxed">
                      <span className="inline-flex items-center gap-1"><IconKey size={13} className="text-slate-400" /> <b className="font-semibold text-slate-700">{p.apiKeys?.length ?? 0}</b> key</span>
                      <span className="inline-flex items-center gap-1"><IconCoin size={13} className="text-slate-400" /> <b className="font-semibold text-slate-700">{formatTokens(tokenByProvider[p.id] ?? 0)}</b> token</span>
                    </div>
                    <div className="flex flex-col gap-2 mt-2 flex-1 content-start">
                      {/* Group model test results by API key */}
                      {(() => {
                        const modelsList = p.selectedModels.length > 0 ? p.selectedModels : p.models;
                        // Build the key groups: from stored apiKeys (or single Default)
                        const keyGroups: Array<{ name: string }> = [];
                        if (p.apiKeys && p.apiKeys.length > 0) {
                          for (const k of p.apiKeys) if (k.enabled !== false) keyGroups.push({ name: k.name });
                        }
                        if (keyGroups.length === 0) keyGroups.push({ name: 'Default' });
                        return keyGroups.map(g => {
                          const groupKey = `${p.id}:${g.name}:`;
                          const groupResults = modelsList.filter(m => modelTestResults[`${groupKey}${m}`]);
                          const hasAny = groupResults.length > 0;
                          return (
                            <div key={g.name} className="rounded-lg border border-slate-200/70 p-2">
                              <div className="text-[11px] font-semibold text-slate-500 mb-1 flex items-center gap-1">
                                <IconKey size={12} className="text-yellow-500" /> {g.name}
                                {hasAny && (
                                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${groupResults.every(m => modelTestResults[`${groupKey}${m}`]?.status === 'ok') ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {groupResults.filter(m => modelTestResults[`${groupKey}${m}`]?.status === 'ok').length}/{groupResults.length} ok
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {modelsList.map(m => {
                                  const rkey = `${groupKey}${m}`;
                                  const result = modelTestResults[rkey];
                                  const statusIcon = result?.status === 'testing' ? <IconSpinner size={11} className="text-slate-400" /> : result?.status === 'ok' ? <IconCheck size={11} className="text-emerald-600" /> : result?.status === 'fail' ? <IconCross size={11} className="text-red-500" /> : null;
                                  const testedBg = result?.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : result?.status === 'fail' ? 'bg-red-50 text-red-700' : 'text-slate-600';
                                  return (
                                    <span key={m} className={`group inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12.5px] font-mono leading-relaxed ${testedBg}`}>
                                      {statusIcon && <span className="text-[10px]">{statusIcon}</span>}
                                      {m}
                                      {result?.status === 'ok' && result.latencyMs && <span className="text-[10px] opacity-70">{formatLatency(result.latencyMs)}</span>}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleTestSingleModel(p, m, p.apiKeys?.find(k => k.name === g.name)?.key, g.name); }}
                                        disabled={result?.status === 'testing'}
                                        className="ml-0.5 opacity-0 group-hover:opacity-100 hover:opacity-100 text-blue-400 hover:text-blue-300 transition-opacity inline-flex items-center"
                                        title="Test model ini"
                                      ><IconSearch size={12} /></button>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    <hr className="card-divider" />

                    <div className="card-actions mt-1">
                      <button
                        onClick={() => handleTestAllModels(p)}
                        disabled={testingAllModels === p.id}
                        className="text-[13.5px] px-2 py-2 rounded-lg bg-blue-50 text-blue-400 hover:text-blue-300 border border-blue-300/40 hover:border-blue-300/70 transition-colors w-full font-medium"
                      >
                        {testingAllModels === p.id ? <span className="flex items-center justify-center gap-2"><IconSpinner size={14} className="text-blue-400" /> Testing...</span> : <span className="inline-flex items-center justify-center gap-1.5"><IconFlask size={14} /> Cek Semua Model</span>}
                      </button>

                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <button onClick={() => openEditModal(p)} className="text-[13.5px] px-2 py-2 rounded-lg bg-slate-100 text-slate-700 hover:text-slate-900 hover:bg-slate-200 border border-slate-300/30 hover:border-blue-300/60 transition-colors font-medium inline-flex items-center justify-center gap-1.5"><IconPencil size={14} /> Edit</button>
                        <button onClick={() => handleDeleteProvider(p.id)} className="text-[13.5px] px-2 py-2 rounded-lg bg-red-50 text-red-300 hover:text-red-200 hover:bg-red-100 border border-red-300/30 hover:border-red-300/60 transition-colors font-medium inline-flex items-center justify-center gap-1.5"><IconTrash size={14} /> Hapus</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Base URL & API Keys — moved to Pengaturan tab */}
          </div>
        )}

        {/* ─── Combos Tab ─────────────────────────── */}
        {activeTab === 'combos' && (
          <div className="space-y-5">
            <div className="flex flex-wrap justify-between items-end gap-3">
              <div>
                <h2 className="text-[23px] font-bold text-slate-900 tracking-tight">Gabung Models</h2>
                <p className="text-[13px] text-slate-500 mt-1 leading-relaxed max-w-xl">Buat model virtual dari gabungan beberapa provider. Pakai nama gabungan sebagai model di request.</p>
              </div>
              <button onClick={openComboModal} className="btn btn-primary text-[13.5px]">+ Buat Gabung</button>
            </div>
            {combos.length === 0 ? (
              <div className="card text-center py-12 text-slate-400"><div className="text-4xl mb-2">🧩</div><p>Belum ada gabungan. Buat gabungan pertama!</p></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {combos.map(c => (
                  <div key={c.id} className="card combo-card p-3 flex flex-col">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-semibold text-slate-900 text-[15px] leading-snug truncate flex-1">{c.name}</h3>
                        <button onClick={() => handleToggleCombo(c)} className={`chip ${c.enabled ? 'chip-cyan status-on' : ''} flex-shrink-0`}>{c.enabled ? '● ON' : '○ OFF'}</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className={`chip ${c.enabled ? 'chip-cyan' : ''}`}>{c.items.length} models</span>
                        <span className="chip inline-flex items-center gap-1"><IconRoute size={12} /> {c.strategy === 'round-robin' ? 'Round Robin' : 'Failover'}</span>
                        {!c.enabled && <span className="chip" style={{opacity:0.8}}>disabled</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2.5">
                        {c.items.map((item, i) => (
                          <span key={i} className="chip-model font-mono" title={`${item.providerName} → ${item.apiKeyName ? item.apiKeyName + ' → ' : ''}${item.model}`}>
                            <span className="prov">{item.providerName}</span>
                            {item.apiKeyName && <><span className="arrow">→</span><span className="key truncate max-w-[6rem] text-yellow-600">{item.apiKeyName}</span></>}
                            <span className="arrow">→</span>
                            <span className="model truncate max-w-[7rem]">{item.model}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <hr className="combo-divider" />
                    <div className="flex gap-2">
                      <button onClick={() => openEditComboModal(c)} className="btn-xs btn-xs-edit flex-1 inline-flex items-center justify-center gap-1.5"><IconPencil size={13} /> Edit</button>
                      <button onClick={() => handleDeleteCombo(c.id)} className="btn-xs btn-xs-del flex-1 inline-flex items-center justify-center"><IconTrash size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Settings Tab ────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-[23px] font-bold text-slate-900 tracking-tight">Dokumentasi</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card">
                <h3 className="font-semibold text-slate-900 mb-3">📡 Base URL</h3>
                <p className="text-sm text-slate-500 mb-3">Pakai URL ini sebagai base URL di platform tujuan (Cursor, Open WebUI, dll).</p>
                <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3">
                  <code className="text-sm text-slate-700 font-mono flex-1">{BASE_URL}</code>
                  <CopyButton text={BASE_URL} />
                </div>
              </div>
              <div className="card">
                <h3 className="font-semibold text-slate-900 mb-3 inline-flex items-center gap-1.5"><IconKey size={15} className="text-slate-500" /> API Keys</h3>
                <div className="flex gap-2 mb-3">
                  <input type="text" className="input flex-1" placeholder="Nama key (e.g. Cursor, Open WebUI)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
                  <button onClick={handleGenerateApiKey} className="btn btn-primary whitespace-nowrap inline-flex items-center gap-1.5"><IconPlus size={14} /> Generate</button>
                </div>
                {generatedKey && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3">
                    <div className="text-sm font-medium text-emerald-800 mb-1 inline-flex items-center gap-1.5"><IconCheck size={14} className="text-emerald-600" /> Key baru!</div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-emerald-700 font-mono flex-1 break-all">{generatedKey}</code>
                      <CopyButton text={generatedKey} />
                    </div>
                    <div className="text-xs text-emerald-600 mt-1 inline-flex items-center gap-1.5"><IconWarning size={12} className="text-amber-500" /> Copy sekarang! Tidak akan ditampilkan lagi.</div>
                  </div>
                )}
                {apiKeys.length > 0 && (
                  <div className="space-y-1">
                    {apiKeys.map(k => (
                      <div key={k.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-yellow-600 text-sm">{k.name}</span>
                          <code className="text-xs text-slate-600 font-mono ml-2 break-all">{k.key}</code>
                        </div>
                        <CopyButton text={k.key} />
                        <button onClick={() => handleDeleteApiKey(k.id)} className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 inline-flex items-center"><IconTrash size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {apiKeys.length === 0 && !generatedKey && (
                  <div className="text-center py-3 text-slate-400 text-sm">Belum ada API key</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Logs Tab ───────────────────────────── */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900">Request Logs</h2>
              <button onClick={handleClearLogs} className="btn btn-secondary text-sm inline-flex items-center gap-1.5"><IconTrash size={14} /> Clear</button>
            </div>
            <div className="card overflow-hidden">
              {/* Desktop table view */}
              <table className="w-full text-sm hidden sm:table">
                <thead><tr className="bg-slate-50 text-left">
                  <th className="px-4 py-2 text-slate-500 font-medium">Time</th><th className="px-4 py-2 text-slate-500 font-medium">Provider</th><th className="px-4 py-2 text-slate-500 font-medium">API Key</th><th className="px-4 py-2 text-slate-500 font-medium">Model</th><th className="px-4 py-2 text-slate-500 font-medium">Status</th><th className="px-4 py-2 text-slate-500 font-medium">Keterangan</th>
                </tr></thead>
                <tbody>
                  {logs.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Belum ada logs</td></tr> :
                    logs.map(log => (
                      <tr key={log.id} className={`border-t border-slate-100 ${log.errorMessage ? 'cursor-pointer hover:bg-red-50 transition-colors' : ''}`} onClick={log.errorMessage ? () => setSelectedLogError(log) : undefined}>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{formatTime(log.createdAt)}</td>
                        <td className="px-4 py-2 text-slate-700">{log.providerName}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs font-mono">{log.apiKeyName || '-'}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{log.model}</td>
                        <td className="px-4 py-2"><div className="flex items-center gap-1">{statusBadge(log.status)}{log.errorMessage && <span title="View error details">🔴</span>}</div></td>
                        <td className="px-4 py-2 text-xs text-red-600 max-w-[200px] truncate">{log.errorMessage ? log.errorMessage.length > 50 ? log.errorMessage.slice(0, 50) + '...' : log.errorMessage : <span className="text-slate-300">-</span>}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
              {/* Mobile card view */}
              <div className="sm:hidden divide-y divide-slate-100">
                {logs.length === 0 ? <div className="px-4 py-8 text-center text-slate-400">Belum ada logs</div> :
                  logs.map(log => (
                    <div key={log.id} className={`p-3 ${log.errorMessage ? 'cursor-pointer hover:bg-red-50 transition-colors' : ''}`} onClick={log.errorMessage ? () => setSelectedLogError(log) : undefined}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500 font-mono">{formatTime(log.createdAt)}</span>
                        <span className="text-xs text-slate-700">{log.providerName}</span>
                      </div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500 font-mono truncate max-w-[60%]">{log.model}</span>
                        <div className="flex items-center gap-1">{statusBadge(log.status)}{log.errorMessage && <span title="View error details">🔴</span>}</div>
                      </div>
                      {log.errorMessage && (
                        <div className="mt-1 text-xs text-red-600 truncate">{log.errorMessage.length > 50 ? log.errorMessage.slice(0, 50) + '...' : log.errorMessage}</div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 font-mono">{log.apiKeyName || '-'}</span>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        )}


      </main>

      {/* ─── Add/Edit Provider Modal ────────────── */}
      {showProviderModal && (
        <div className="fixed inset-0 bg-black/50 z-50 p-0 sm:p-4 flex flex-col sm:items-center sm:justify-center">
          <div className="flex-1 sm:flex-none" onClick={() => { setShowProviderModal(false); resetProviderForm(); }} />
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{editingProvider ? 'Edit Provider' : 'Tambah Provider'}</h3>
                <button onClick={() => { setShowProviderModal(false); resetProviderForm(); }} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>

              {/* Provider Type Selector (only for new providers) */}
              {!editingProvider && !providerType && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">Pilih jenis provider:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => { setProviderType('custom'); setProviderForm(f => ({ ...f, baseUrl: '' })); }}
                      className="p-4 rounded-xl border-2 border-slate-200 hover:border-green-400 text-left transition-colors"
                    >
                      <div className="text-2xl mb-2">🔌</div>
                      <div className="font-semibold text-slate-900">Custom</div>
                      <div className="text-xs text-slate-500 mt-1">OpenRouter, Together AI, atau provider OpenAI-compatible lainnya</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProviderType('chatgpt_plus'); handleChatgptStart(); }}
                      className="p-4 rounded-xl border-2 border-slate-200 hover:border-emerald-400 text-left transition-colors"
                    >
                      <div className="text-2xl mb-2">✨</div>
                      <div className="font-semibold text-slate-900">ChatGPT Plus</div>
                      <div className="text-xs text-slate-500 mt-1">Login pakai akun ChatGPT Plus. Tanpa API key.</div>
                    </button>
                  </div>
                </div>
              )}

              {/* ChatGPT Plus Login Flow */}
              {!editingProvider && providerType === 'chatgpt_plus' && (
                <div className="space-y-4">
                  {chatgptStep === 'waiting' && (
                    <div className="text-center py-8">
                      <div className="pulse-dot text-cyan-400 mb-3"><IconSpinnerLg size={36} className="text-cyan-400" /></div>
                      <p className="text-slate-600">Meminta kode login dari OpenAI...</p>
                    </div>
                  )}
                  {chatgptStep === 'code' && (
                    <div className="space-y-4">
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <p className="text-sm font-medium text-blue-800 mb-3">Ikuti langkah berikut:</p>
                        <div className="space-y-3">
                          <div className="flex gap-3 items-start">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold">1</span>
                            <div>
                              <p className="text-sm text-blue-900">Buka link ini di browser:</p>
                              <a href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline font-mono">https://auth.openai.com/codex/device</a>
                            </div>
                          </div>
                          <div className="flex gap-3 items-start">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold">2</span>
                            <div>
                              <p className="text-sm text-blue-900">Masukkan kode ini:</p>
                              <div className="flex items-center gap-2 mt-1">
                                <code className="bg-blue-100 px-4 py-2 rounded-lg text-xl font-bold text-blue-800 tracking-wider">{chatgptUserCode}</code>
                                <CopyButton text={chatgptUserCode} />
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-3 items-start">
                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold">3</span>
                            <div>
                              <p className="text-sm text-blue-900">Login pakai akun <strong>ChatGPT Plus</strong> kamu</p>
                              <p className="text-xs text-blue-600 mt-1">Provider akan otomatis dibuat setelah login berhasil</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                        <span className="pulse-dot"><IconSpinner size={14} className="text-cyan-400" /></span>
                        <span>Menunggu login...</span>
                      </div>
                    </div>
                  )}
                  {chatgptStep === 'done' && (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-3 text-emerald-500"><IconCheck size={36} className="text-emerald-500" /></div>
                      <p className="text-emerald-700 font-medium">Berhasil terhubung!</p>
                      <p className="text-sm text-slate-500 mt-1">Provider ChatGPT Plus sudah ditambahkan</p>
                    </div>
                  )}
                  {chatgptStep === 'error' && (
                    <div className="space-y-3">
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                        <p className="text-red-700 font-medium inline-flex items-center gap-1.5"><IconCross size={16} className="text-red-500" /> {chatgptError || 'Login gagal'}</p>
                      </div>
                      <button onClick={() => { setChatgptStep('idle'); setProviderType(null); }} className="btn btn-secondary w-full">Coba Lagi</button>
                    </div>
                  )}
                  {chatgptStep !== 'done' && chatgptStep !== 'waiting' && (
                    <button onClick={() => { setShowProviderModal(false); resetProviderForm(); }} className="btn btn-secondary w-full">Batal</button>
                  )}
                </div>
              )}

              {/* Custom Provider Form */}
              {(editingProvider || providerType === 'custom') && (
                <>
              <div className="space-y-3">
                <div><label className="text-sm text-slate-600">Nama Provider</label><input type="text" className="input mt-1" placeholder="e.g. OpenRouter, Together AI" value={providerForm.name} onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><label className="text-sm text-slate-600">Base URL</label><input type="text" className="input mt-1" placeholder="https://openrouter.ai/api/v1" value={providerForm.baseUrl} onChange={e => setProviderForm(f => ({ ...f, baseUrl: e.target.value }))} /></div>
                <div>
                  <label className="text-sm text-slate-600">API Keys {providerFormKeys.length > 1 && <span className="text-xs text-slate-400">(urutan = prioritas, teratas didahulukan)</span>}</label>
                  <div className="space-y-2 mt-1">
                    {providerFormKeys.map((fk, idx) => {
                      const isExisting = editingProvider && editingProvider.apiKeys && idx < editingProvider.apiKeys.length && !fk.key;
                      return (
                        <div key={idx} className="flex flex-col gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="flex items-center justify-between">
                            <input type="text" className="input flex-1 text-sm" placeholder="Nama key (e.g. Akun Utama, Akun Cadangan)" value={fk.name} onChange={e => {
                              const updated = [...providerFormKeys];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              setProviderFormKeys(updated);
                            }} />
                            {providerFormKeys.length > 1 && (
                              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                <button type="button" aria-label="Pindah ke atas" disabled={idx === 0} onClick={() => {
                                  if (idx === 0) return;
                                  const updated = [...providerFormKeys];
                                  [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                                  setProviderFormKeys(updated);
                                }} className="px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm disabled:opacity-30 disabled:cursor-not-allowed">↑</button>
                                <button type="button" aria-label="Pindah ke bawah" disabled={idx === providerFormKeys.length - 1} onClick={() => {
                                  if (idx === providerFormKeys.length - 1) return;
                                  const updated = [...providerFormKeys];
                                  [updated[idx + 1], updated[idx]] = [updated[idx], updated[idx + 1]];
                                  setProviderFormKeys(updated);
                                }} className="px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm disabled:opacity-30 disabled:cursor-not-allowed">↓</button>
                                <button type="button" onClick={() => setProviderFormKeys(prev => prev.filter((_, i) => i !== idx))} className="px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 text-sm">✕</button>
                              </div>
                            )}
                          </div>
                          <div>
                            <input type="text" className="input w-full text-sm font-mono" placeholder={isExisting ? 'Kosongkan untuk mempertahankan key saat ini' : 'Masukkan API key lengkap'} value={fk.key} onChange={e => {
                              const updated = [...providerFormKeys];
                              updated[idx] = { ...updated[idx], key: e.target.value };
                              setProviderFormKeys(updated);
                            }} />
                            {isExisting && editingProvider!.apiKeys[idx] && (
                              <p className="text-xs text-slate-400 mt-1">Key saat ini (edit untuk mengubah):</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => setProviderFormKeys(prev => [...prev, { name: `Key ${prev.length + 1}`, key: '' }])} className="mt-2 text-sm font-medium text-green-600 hover:text-green-800">+ Tambah Key</button>

                  {/* API Key Strategy */}
                  {providerFormKeys.length > 1 && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <label className="text-sm text-slate-600 mb-2 block inline-flex items-center gap-1.5"><IconKey size={14} className="text-slate-400" /> Strategi Pemilihan API Key</label>
                      <div className="grid grid-cols-1 gap-2">
                        <button type="button" onClick={() => setProviderFormStrategy('random')} className={`p-2 rounded-lg border-2 text-left text-sm transition-colors ${providerFormStrategy === 'random' ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                          <span className="font-medium text-slate-900 inline-flex items-center gap-1.5"><IconSync size={13} className="text-slate-400" /> Random</span>
                          <span className="block text-xs text-slate-500 mt-0.5">Pick random key setiap request</span>
                        </button>
                        <button type="button" onClick={() => setProviderFormStrategy('failover-priority')} className={`p-2 rounded-lg border-2 text-left text-sm transition-colors ${providerFormStrategy === 'failover-priority' ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                          <span className="font-medium text-slate-900 inline-flex items-center gap-1.5"><IconRoute size={13} className="text-slate-400" /> Failover Priority</span>
                          <span className="block text-xs text-slate-500 mt-0.5">Pakai key pertama, jika gagal ke key berikutnya</span>
                        </button>
                        <button type="button" onClick={() => setProviderFormStrategy('round-robin')} className={`p-2 rounded-lg border-2 text-left text-sm transition-colors ${providerFormStrategy === 'round-robin' ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                          <span className="font-medium text-slate-900 inline-flex items-center gap-1.5"><IconSync size={13} className="text-slate-400" /> Round Robin</span>
                          <span className="block text-xs text-slate-500 mt-0.5">Rotasi berurutan ke semua key secara merata</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <button onClick={handleTestConnection} disabled={testingConnection || !providerForm.baseUrl || (providerFormKeys.every(k => !k.key || k.key.startsWith('•')) && !editingProvider)} className="btn btn-primary w-full">
                  {testingConnection ? <span className="flex items-center justify-center gap-2"><IconSpinner size={14} className="text-blue-400" /> Testing...</span> : <span className="inline-flex items-center justify-center gap-1.5"><IconPlug size={14} /> Test Connection & Discover Models</span>}
                </button>
                {testResult && (
                  <div className="mt-3 space-y-2">
                    {/* Per-key results */}
                    {Array.isArray(testResult.keyResults) && testResult.keyResults.length > 0 && (
                      <div className="space-y-1.5">
                        {testResult.keyResults.map((kr: any, i: number) => (
                          <div key={i} className={`p-2 rounded-lg text-sm flex items-center justify-between gap-2 ${kr.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            <span className="font-medium truncate inline-flex items-center gap-1.5">{kr.ok ? <IconCheck size={14} className="text-emerald-600" /> : <IconCross size={14} className="text-red-500" />} {kr.name}</span>
                            <span className="text-xs flex-shrink-0">
                              {kr.ok ? `${kr.modelCount} models • ${formatLatency(kr.latencyMs || 0)}` : (kr.error || 'Failed')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Overall summary */}
                    <div className={`p-3 rounded-lg text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {testResult.success
                        ? <div><div className="font-medium inline-flex items-center gap-1.5"><IconCheck size={15} className="text-emerald-600" /> {testResult.keyResults.filter((k: any) => k.ok).length}/{testResult.keyResults.length} key berhasil terhubung</div><div className="text-xs mt-1">{testResult.modelCount ?? testResult.models?.length} models ditemukan • {formatLatency(testResult.latencyMs || 0)}</div></div>
                        : <div><div className="font-medium inline-flex items-center gap-1.5"><IconCross size={15} className="text-red-500" /> Failed</div><div className="text-xs mt-1">{testResult.error}</div></div>}
                    </div>
                  </div>
                )}
              </div>
              {discoveredModels.length > 0 && (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Pilih Model ({selectedModels.length}/{discoveredModels.length})</label>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedModels([...discoveredModels])} className="text-xs text-green-600 hover:text-green-800">Pilih Semua</button>
                      <button onClick={() => setSelectedModels([])} className="text-xs text-slate-500 hover:text-slate-700">Hapus Semua</button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={e => setModelSearch(e.target.value)}
                    placeholder="Cari model... (mis. gpt, claude)"
                    className="input mb-2"
                  />
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {discoveredModels
                      .filter(m => m.toLowerCase().includes(modelSearch.toLowerCase().trim()))
                      .map(model => (
                      <label key={model} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={selectedModels.includes(model)} onChange={() => toggleModel(model)} className="rounded border-slate-300 text-green-600" />
                        <span className="text-sm font-mono text-slate-700">{model}</span>
                      </label>
                    ))}
                    {discoveredModels.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase().trim())).length === 0 && (
                      <div className="px-3 py-4 text-center text-xs text-slate-400">Tidak ada model cocok "{modelSearch}"</div>
                    )}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowProviderModal(false); resetProviderForm(); }} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={handleSaveProvider} disabled={discoveredModels.length === 0 || selectedModels.length === 0} className="btn btn-primary flex-1">{editingProvider ? '💾 Update' : '+ Tambah'}</button>
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Create/Edit Combo Modal ─────────────── */}
      {showComboModal && (
        <div className="fixed inset-0 bg-black/50 z-50 p-0 sm:p-4 flex flex-col sm:items-center sm:justify-center">
          <div className="flex-1 sm:flex-none" onClick={() => { setShowComboModal(false); setEditingCombo(null); }} />
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{editingCombo ? 'Edit Combo' : 'Buat Combo Model'}</h3>
                <button onClick={() => { setShowComboModal(false); setEditingCombo(null); }} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div>
                <label className="text-sm text-slate-600">Nama Combo</label>
                <input type="text" className="input mt-1" placeholder="e.g. gpt-4-combo, fast-mix" value={comboForm.name} onChange={e => setComboForm(f => ({ ...f, name: e.target.value }))} />
                <p className="text-xs text-slate-400 mt-1">Nama ini yang dipakai sebagai model di request API</p>
              </div>
              <div>
                <label className="text-sm text-slate-600">Strategy</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button type="button" onClick={() => setComboForm(f => ({ ...f, strategy: 'failover-priority' }))} className={`p-3 rounded-lg border-2 text-left text-sm transition-colors ${comboForm.strategy === 'failover-priority' ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <div className="font-medium text-slate-900 inline-flex items-center gap-1.5"><IconRoute size={14} className="text-slate-400" /> Failover Priority</div>
                    <div className="text-xs text-slate-500 mt-1">Pilih random dari list. Gagal → coba lain.</div>
                  </button>
                  <button type="button" onClick={() => setComboForm(f => ({ ...f, strategy: 'round-robin' }))} className={`p-3 rounded-lg border-2 text-left text-sm transition-colors ${comboForm.strategy === 'round-robin' ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <div className="font-medium text-slate-900 inline-flex items-center gap-1.5"><IconSync size={14} className="text-slate-400" /> Round Robin</div>
                    <div className="text-xs text-slate-500 mt-1">Rotasi berurutan, merata ke semua model.</div>
                  </button>
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-700">Urutan: Provider → API Key → Model ({comboItems.length})</label>
                  <button onClick={addComboItem} className="text-xs text-green-600 hover:text-green-800">+ Tambah Item</button>
                </div>
                <div className="space-y-3">
                  {comboItems.map((item, i) => {
                    const provider = providers.find(p => p.id === item.providerId);
                    const availableModels = provider ? provider.selectedModels : [];
                    return (
                      <div key={i} className="flex gap-2 items-end">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => moveComboItem(i, 'up')}
                            disabled={i === 0}
                            className="text-xs px-1.5 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Pindah ke atas (prioritas lebih tinggi)"
                          >▲</button>
                          <button
                            onClick={() => moveComboItem(i, 'down')}
                            disabled={i === comboItems.length - 1}
                            className="text-xs px-1.5 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Pindah ke bawah (prioritas lebih rendah)"
                          >▼</button>
                        </div>
                        <div className="flex-1">
                          <select className="input" value={item.providerId} onChange={e => updateComboItem(i, 'providerId', e.target.value)}>
                            <option value="">Pilih Provider...</option>
                            {providers.filter(p => p.enabled || (p.apiKeys && p.apiKeys.filter(k => k.enabled !== false).length > 1)).map(p => <option key={p.id} value={p.id}>{p.name}{p.enabled ? '' : ' (multi-key)'}</option>)}
                          </select>
                        </div>
                        <div className="flex-1">
                          <select className="input" value={item.apiKeyName ?? ''} onChange={e => updateComboItem(i, 'apiKeyName', e.target.value)}>
                            <option value="">— Semua key (urutan) —</option>
                            {provider?.apiKeys?.filter(k => k.enabled !== false).map(k => <option key={k.name} value={k.name}>{k.name}</option>)}
                          </select>
                        </div>
                        <div className="flex-1">
                          <select className="input" value={item.model} onChange={e => updateComboItem(i, 'model', e.target.value)}>
                            <option value="">Pilih Model...</option>
                            {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <span className="text-xs text-slate-400 font-mono w-6 text-center">#{i + 1}</span>
                        <button onClick={() => removeComboItem(i)} className="text-xs px-2 py-2 rounded bg-red-50 text-red-600 hover:bg-red-100">✕</button>
                      </div>
                    );
                  })}
                </div>
                {comboItems.length === 0 && <div className="text-center py-4 text-slate-400 text-sm">Klik "+ Tambah Item" untuk mulai</div>}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowComboModal(false); setEditingCombo(null); }} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={handleSaveCombo} disabled={comboItems.length === 0 || !comboForm.name.trim()} className="btn btn-primary flex-1">{editingCombo ? '💾 Update' : '🧩 Buat Combo'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Quota Modal ─────────────────────── */}
      {showQuotaModal && (
        <div className="fixed inset-0 bg-black/50 z-50 p-0 sm:p-4 flex flex-col sm:items-center sm:justify-center">
          <div className="flex-1 sm:flex-none" onClick={() => setShowQuotaModal(false)} />
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-sm">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Tambah Quota</h3>
                <button onClick={() => setShowQuotaModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div>
                <label className="text-sm text-slate-600">Provider</label>
                <select className="input mt-1" value={quotaForm.providerId} onChange={e => setQuotaForm(f => ({ ...f, providerId: e.target.value }))}>
                  <option value="">Pilih Provider...</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-600">Monthly Limit (tokens)</label>
                <input type="number" className="input mt-1" placeholder="0 = unlimited" min={0} value={quotaForm.monthlyLimit} onChange={e => setQuotaForm(f => ({ ...f, monthlyLimit: parseInt(e.target.value) || 0 }))} />
                <p className="text-xs text-slate-400 mt-1">Isi 0 untuk tracking only (tanpa limit)</p>
              </div>
              <div>
                <label className="text-sm text-slate-600">Reset Day</label>
                <input type="number" className="input mt-1" min={1} max={28} value={quotaForm.resetDay} onChange={e => setQuotaForm(f => ({ ...f, resetDay: parseInt(e.target.value) || 1 }))} />
                <p className="text-xs text-slate-400 mt-1">Tanggal reset counter setiap bulan (1-28)</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowQuotaModal(false)} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={handleSaveQuota} disabled={!quotaForm.providerId} className="btn btn-primary flex-1 inline-flex items-center justify-center gap-1.5"><IconChart size={15} /> Tambah</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Error Detail Modal ─────────────────────── */}
      {selectedLogError && (
        <div className="fixed inset-0 bg-black/50 z-50 p-0 sm:p-4 flex flex-col sm:items-center sm:justify-center" onClick={() => setSelectedLogError(null)}>
          <div className="flex-1 sm:flex-none" />
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">🔴 Error Details</h3>
                <button onClick={() => setSelectedLogError(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div className="space-y-3">
                <div className="flex gap-4 text-sm">
                  <div><span className="text-slate-500">Time:</span> <span className="font-mono text-slate-700">{formatTime(selectedLogError.createdAt)}</span></div>
                  <div><span className="text-slate-500">Provider:</span> <span className="text-slate-700">{selectedLogError.providerName}</span></div>
                  <div><span className="text-slate-500">Model:</span> <span className="font-mono text-slate-700">{selectedLogError.model}</span></div>
                </div>
                <div className="flex gap-4 text-sm">
                  <div><span className="text-slate-500">Status:</span> {statusBadge(selectedLogError.status)}</div>
                  {selectedLogError.statusCode && <div><span className="text-slate-500">Code:</span> <span className="font-mono text-slate-700">{selectedLogError.statusCode}</span></div>}
                  <div><span className="text-slate-500">Latency:</span> <span className="text-slate-700">{formatLatency(selectedLogError.latencyMs)}</span></div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="text-sm font-medium text-red-800 mb-2">Error Message:</div>
                  <pre className="text-sm text-red-700 whitespace-pre-wrap break-words font-mono">{selectedLogError.errorMessage}</pre>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={() => setSelectedLogError(null)} className="btn btn-secondary">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
