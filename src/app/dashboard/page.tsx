'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  selectedModels: string[];
  priority: number;
  enabled: boolean;
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

interface ComboItem {
  providerId: string;
  providerName: string;
  model: string;
}

interface Combo {
  id: string;
  name: string;
  items: ComboItem[];
  enabled: boolean;
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
      {copied ? '✅' : '📋'}
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

  const [activeTab, setActiveTab] = useState<'providers' | 'logs' | 'settings' | 'combos'>('providers');
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  // Provider form
  const [providerForm, setProviderForm] = useState({ name: '', baseUrl: '', apiKey: '' });
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // API key
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  // Combo form
  const [showComboModal, setShowComboModal] = useState(false);
  const [comboForm, setComboForm] = useState({ name: '' });
  const [comboItems, setComboItems] = useState<ComboItem[]>([]);

  // Settings
  const [settingsForm, setSettingsForm] = useState({ maxRetries: 3, timeoutMs: 30000 });

  // ─── API helper ──────────────────────────────────

  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const t = token || getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) { clearToken(); setTokenState(null); throw new Error('Unauthorized'); }
    return res;
  }, [token]);

  // ─── Data fetching ───────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [provRes, logRes, statsRes, configRes, keysRes, combosRes] = await Promise.all([
        api('/api/providers'),
        api('/api/logs?limit=50'),
        api('/api/stats'),
        api('/api/config'),
        api('/api/api-keys'),
        api('/api/combos'),
      ]);
      if (provRes.ok) setProviders(await provRes.json());
      if (logRes.ok) { const d = await logRes.json(); setLogs(d.logs || d); }
      if (statsRes.ok) setStats(await statsRes.json());
      if (configRes.ok) { const c = await configRes.json(); setConfig(c); setSettingsForm({ maxRetries: c.maxRetries, timeoutMs: c.timeoutMs }); }
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
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [token, fetchData]);

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

  async function handleTestConnection() {
    if (!providerForm.baseUrl || !providerForm.apiKey) return;
    setTestingConnection(true); setTestResult(null); setDiscoveredModels([]); setSelectedModels([]);
    try {
      const res = await api('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: providerForm.baseUrl, apiKey: providerForm.apiKey }),
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
    if (!providerForm.name || !providerForm.baseUrl || !providerForm.apiKey) return;
    if (discoveredModels.length === 0) { alert('Test connection dulu untuk discover models!'); return; }
    if (selectedModels.length === 0) { alert('Pilih minimal 1 model!'); return; }
    try {
      const body = { name: providerForm.name, baseUrl: providerForm.baseUrl, apiKey: providerForm.apiKey, models: discoveredModels, selectedModels, priority: 10, enabled: true };
      const res = editingProvider
        ? await api('/api/providers', { method: 'PUT', body: JSON.stringify({ id: editingProvider.id, ...body }) })
        : await api('/api/providers', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) { setShowProviderModal(false); resetProviderForm(); fetchData(); }
      else { const err = await res.json(); alert(err.error || 'Failed'); }
    } catch { alert('Network error'); }
  }

  async function handleDeleteProvider(id: string) {
    if (!confirm('Hapus provider ini?')) return;
    try { await api(`/api/providers?id=${id}`, { method: 'DELETE' }); fetchData(); } catch {}
  }

  async function handleToggleProvider(provider: Provider) {
    try { await api('/api/providers', { method: 'PUT', body: JSON.stringify({ id: provider.id, enabled: !provider.enabled }) }); fetchData(); } catch {}
  }

  function openEditModal(provider: Provider) {
    setEditingProvider(provider);
    setProviderForm({ name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey });
    setDiscoveredModels(provider.models);
    setSelectedModels(provider.selectedModels);
    setTestResult(null);
    setShowProviderModal(true);
  }

  function resetProviderForm() {
    setProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setDiscoveredModels([]); setSelectedModels([]); setTestResult(null); setEditingProvider(null);
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
    try { await api(`/api/api-keys?id=${id}`, { method: 'DELETE' }); fetchData(); } catch {}
  }

  // ─── Combo actions ───────────────────────────────

  function openComboModal() {
    setComboForm({ name: '' });
    setComboItems([]);
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
        updated[index] = { ...updated[index], providerId: value, providerName: provider?.name || '', model: '' };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  }

  function removeComboItem(index: number) {
    setComboItems(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSaveCombo() {
    if (!comboForm.name.trim()) { alert('Nama combo wajib diisi!'); return; }
    if (comboItems.length === 0) { alert('Tambah minimal 1 model!'); return; }
    if (comboItems.some(item => !item.providerId || !item.model)) { alert('Isi semua field!'); return; }
    try {
      const res = await api('/api/combos', {
        method: 'POST',
        body: JSON.stringify({ name: comboForm.name.trim(), items: comboItems }),
      });
      if (res.ok) { setShowComboModal(false); fetchData(); }
      else { const err = await res.json(); alert(err.error || 'Failed'); }
    } catch { alert('Network error'); }
  }

  async function handleDeleteCombo(id: string) {
    if (!confirm('Hapus combo ini?')) return;
    try { await api(`/api/combos?id=${id}`, { method: 'DELETE' }); fetchData(); } catch {}
  }

  async function handleToggleCombo(combo: Combo) {
    try { await api('/api/combos', { method: 'PUT', body: JSON.stringify({ id: combo.id, enabled: !combo.enabled }) }); fetchData(); } catch {}
  }

  // ─── Settings ────────────────────────────────────

  async function handleChangeMode(mode: string) {
    try { await api('/api/config', { method: 'PUT', body: JSON.stringify({ mode }) }); fetchData(); } catch {}
  }

  async function handleSaveSettings() {
    try { await api('/api/config', { method: 'PUT', body: JSON.stringify(settingsForm) }); fetchData(); } catch {}
  }

  async function handleHealthCheck() {
    try { await api('/api/health'); fetchData(); } catch {}
  }

  async function handleClearLogs() {
    if (!confirm('Hapus semua logs?')) return;
    try { await api('/api/logs', { method: 'DELETE' }); fetchData(); } catch {}
  }

  // ─── UI helpers ──────────────────────────────────

  function healthBadge(status: string) {
    const colors: Record<string, string> = { healthy: 'bg-emerald-100 text-emerald-700', degraded: 'bg-amber-100 text-amber-700', down: 'bg-red-100 text-red-700', unknown: 'bg-slate-100 text-slate-500' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.unknown}`}>{status}</span>;
  }

  function statusBadge(status: string) {
    const colors: Record<string, string> = { success: 'bg-emerald-100 text-emerald-700', error: 'bg-red-100 text-red-700', timeout: 'bg-amber-100 text-amber-700', retry: 'bg-blue-100 text-blue-700' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-slate-100 text-slate-500'}`}>{status}</span>;
  }

  function formatTime(ts: string) { return new Date(ts).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function formatLatency(ms: number) { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`; }

  const BASE_URL = 'https://razoter.vercel.app/v1';

  // ─── Login screen ────────────────────────────────

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="pulse-dot text-4xl">⏳</div></div>;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <form onSubmit={handleLogin} className="card w-full max-w-sm space-y-4">
          <div className="text-center"><h1 className="text-2xl font-bold text-slate-900">Razoter</h1><p className="text-sm text-slate-500 mt-1">Dashboard Login</p></div>
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
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3"><h1 className="text-xl font-bold text-slate-900">Razoter</h1><span className="text-xs text-slate-400">v2.1</span></div>
          <div className="flex items-center gap-4">
            <button onClick={handleHealthCheck} className="btn btn-secondary text-sm">🏥 Health Check</button>
            <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-red-600">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center"><div className="text-2xl font-bold text-slate-900">{stats.totalRequests}</div><div className="text-xs text-slate-500">Total Requests</div></div>
            <div className="card text-center"><div className="text-2xl font-bold text-emerald-600">{stats.successRate}%</div><div className="text-xs text-slate-500">Success Rate</div></div>
            <div className="card text-center"><div className="text-2xl font-bold text-slate-900">{formatLatency(stats.avgLatency)}</div><div className="text-xs text-slate-500">Avg Latency</div></div>
            <div className="card text-center"><div className="text-2xl font-bold text-slate-900">{providers.length}</div><div className="text-xs text-slate-500">Providers</div></div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['providers', 'combos', 'logs', 'settings'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {tab === 'providers' ? '🔌 Providers' : tab === 'combos' ? '🧩 Combos' : tab === 'logs' ? '📋 Logs' : '⚙️ Settings'}
            </button>
          ))}
        </div>

        {/* ─── Providers Tab ──────────────────────── */}
        {activeTab === 'providers' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900">Providers</h2>
              <button onClick={() => { resetProviderForm(); setShowProviderModal(true); }} className="btn btn-primary">+ Add Provider</button>
            </div>
            {providers.length === 0 ? (
              <div className="card text-center py-12 text-slate-400"><div className="text-4xl mb-2">🔌</div><p>Belum ada provider. Tambah provider pertama!</p></div>
            ) : (
              <div className="space-y-3">
                {providers.map(p => (
                  <div key={p.id} className="card">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-slate-900">{p.name}</h3>
                          {healthBadge(p.healthStatus)}
                          {!p.enabled && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-500">disabled</span>}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono">{p.baseUrl}</div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {p.selectedModels.map(m => <span key={m} className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs font-mono">{m}</span>)}
                          {p.selectedModels.length < p.models.length && <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-400 text-xs">+{p.models.length - p.selectedModels.length} more</span>}
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-slate-500">
                          <span>📊 {p.totalRequests} req</span><span>✅ {p.successCount} ok</span><span>❌ {p.errorCount} err</span><span>⚡ {formatLatency(p.avgLatencyMs)} avg</span>
                          {p.rateLimitRemaining !== null && <span>🚦 {p.rateLimitRemaining}/{p.rateLimitTotal}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleToggleProvider(p)} className={`text-xs px-2 py-1 rounded ${p.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{p.enabled ? 'ON' : 'OFF'}</button>
                        <button onClick={() => openEditModal(p)} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">Edit</button>
                        <button onClick={() => handleDeleteProvider(p.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Hapus</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Combos Tab ─────────────────────────── */}
        {activeTab === 'combos' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Combo Models</h2>
                <p className="text-sm text-slate-500">Buat model virtual dari gabungan beberapa provider. Pakai nama combo sebagai model di request.</p>
              </div>
              <button onClick={openComboModal} className="btn btn-primary">+ Buat Combo</button>
            </div>
            {combos.length === 0 ? (
              <div className="card text-center py-12 text-slate-400"><div className="text-4xl mb-2">🧩</div><p>Belum ada combo. Buat combo pertama!</p></div>
            ) : (
              <div className="space-y-3">
                {combos.map(c => (
                  <div key={c.id} className="card">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-slate-900 font-mono">{c.name}</h3>
                          {!c.enabled && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-500">disabled</span>}
                          <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-600 text-xs">{c.items.length} models</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {c.items.map((item, i) => (
                            <span key={i} className="px-2 py-1 rounded bg-slate-50 border border-slate-200 text-xs">
                              <span className="text-slate-500">{item.providerName}</span>
                              <span className="text-slate-300 mx-1">→</span>
                              <span className="font-mono text-slate-700">{item.model}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleToggleCombo(c)} className={`text-xs px-2 py-1 rounded ${c.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{c.enabled ? 'ON' : 'OFF'}</button>
                        <button onClick={() => handleDeleteCombo(c.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Hapus</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── Logs Tab ───────────────────────────── */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900">Request Logs</h2>
              <button onClick={handleClearLogs} className="btn btn-secondary text-sm">🗑️ Clear</button>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-left">
                  <th className="px-4 py-2 text-slate-500 font-medium">Time</th><th className="px-4 py-2 text-slate-500 font-medium">Provider</th><th className="px-4 py-2 text-slate-500 font-medium">Model</th><th className="px-4 py-2 text-slate-500 font-medium">Status</th><th className="px-4 py-2 text-slate-500 font-medium">Latency</th><th className="px-4 py-2 text-slate-500 font-medium">Tokens</th>
                </tr></thead>
                <tbody>
                  {logs.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Belum ada logs</td></tr> :
                    logs.map(log => (
                      <tr key={log.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{formatTime(log.createdAt)}</td>
                        <td className="px-4 py-2 text-slate-700">{log.providerName}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{log.model}</td>
                        <td className="px-4 py-2">{statusBadge(log.status)}</td>
                        <td className="px-4 py-2 text-slate-500">{formatLatency(log.latencyMs)}</td>
                        <td className="px-4 py-2 text-slate-500">{log.tokensUsed ?? '-'}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Settings Tab ───────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* Base URL */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">📡 Base URL</h3>
              <p className="text-sm text-slate-500 mb-3">Pakai URL ini sebagai base URL di platform tujuan (Cursor, Open WebUI, dll).</p>
              <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3">
                <code className="text-sm text-slate-700 font-mono flex-1">{BASE_URL}</code>
                <CopyButton text={BASE_URL} />
              </div>
            </div>

            {/* API Keys List */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">🔑 API Keys</h3>
              <p className="text-sm text-slate-500 mb-4">Generate API key untuk menghubungkan Razoter ke platform tujuan.</p>
              
              {/* Generate new key */}
              <div className="flex gap-2 mb-4">
                <input type="text" className="input flex-1" placeholder="Nama key (e.g. Cursor, Open WebUI)" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} />
                <button onClick={handleGenerateApiKey} className="btn btn-primary whitespace-nowrap">🎲 Generate</button>
              </div>

              {generatedKey && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
                  <div className="text-sm font-medium text-emerald-800 mb-2">✅ Key baru berhasil di-generate!</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-emerald-700 font-mono flex-1 break-all">{generatedKey}</code>
                    <CopyButton text={generatedKey} />
                  </div>
                  <div className="text-xs text-emerald-600 mt-2">⚠️ Copy sekarang! Tidak akan ditampilkan lagi setelah refresh.</div>
                </div>
              )}

              {/* Keys list */}
              {apiKeys.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Key yang sudah dibuat:</div>
                  {apiKeys.map(k => (
                    <div key={k.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-700 text-sm">{k.name}</div>
                        <code className="text-xs text-slate-500 font-mono">{k.key.slice(0, 8)}...{k.key.slice(-4)}</code>
                      </div>
                      <CopyButton text={k.key} />
                      <button onClick={() => handleDeleteApiKey(k.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">🗑️</button>
                    </div>
                  ))}
                </div>
              )}

              {apiKeys.length === 0 && !generatedKey && (
                <div className="text-center py-4 text-slate-400 text-sm">Belum ada API key</div>
              )}
            </div>

            {/* Rotation Mode */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">🔄 Rotation Mode</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { mode: 'failover', label: 'Failover', desc: 'Gagal → switch ke provider lain', icon: '🔄' },
                  { mode: 'round-robin', label: 'Round Robin', desc: 'Rotasi merata antar provider', icon: '⚡' },
                  { mode: 'priority', label: 'Priority', desc: 'Prioritas lebih tinggi dipilih duluan', icon: '📊' },
                ].map(m => (
                  <button key={m.mode} onClick={() => handleChangeMode(m.mode)} className={`p-4 rounded-lg border-2 text-left transition-colors ${config?.mode === m.mode ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <div className="text-lg mb-1">{m.icon}</div><div className="font-medium text-slate-900">{m.label}</div><div className="text-xs text-slate-500 mt-1">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Retry & Timeout */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">⚙️ Retry & Timeout</h3>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm text-slate-600">Max Retries</label><input type="number" min={1} max={10} className="input mt-1" value={settingsForm.maxRetries} onChange={e => setSettingsForm(f => ({ ...f, maxRetries: parseInt(e.target.value) || 3 }))} /></div>
                <div><label className="text-sm text-slate-600">Timeout (ms)</label><input type="number" min={5000} max={120000} step={1000} className="input mt-1" value={settingsForm.timeoutMs} onChange={e => setSettingsForm(f => ({ ...f, timeoutMs: parseInt(e.target.value) || 30000 }))} /></div>
              </div>
              <button onClick={handleSaveSettings} className="btn btn-primary mt-4">💾 Simpan</button>
            </div>
          </div>
        )}
      </main>

      {/* ─── Add/Edit Provider Modal ────────────── */}
      {showProviderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{editingProvider ? 'Edit Provider' : 'Tambah Provider'}</h3>
                <button onClick={() => { setShowProviderModal(false); resetProviderForm(); }} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div className="space-y-3">
                <div><label className="text-sm text-slate-600">Nama Provider</label><input type="text" className="input mt-1" placeholder="e.g. OpenRouter, Together AI" value={providerForm.name} onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><label className="text-sm text-slate-600">Base URL</label><input type="text" className="input mt-1" placeholder="https://openrouter.ai/api/v1" value={providerForm.baseUrl} onChange={e => setProviderForm(f => ({ ...f, baseUrl: e.target.value }))} /></div>
                <div><label className="text-sm text-slate-600">API Key</label><input type="password" className="input mt-1" placeholder="sk-..." value={providerForm.apiKey} onChange={e => setProviderForm(f => ({ ...f, apiKey: e.target.value }))} /></div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <button onClick={handleTestConnection} disabled={testingConnection || !providerForm.baseUrl || !providerForm.apiKey} className="btn btn-primary w-full">
                  {testingConnection ? <span className="flex items-center justify-center gap-2"><span className="pulse-dot">⏳</span> Testing...</span> : '🔌 Test Connection & Discover Models'}
                </button>
                {testResult && (
                  <div className={`mt-3 p-3 rounded-lg text-sm ${testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {testResult.success ? <div><div className="font-medium">✅ Connected!</div><div className="text-xs mt-1">{testResult.modelCount} models ditemukan • {formatLatency(testResult.latencyMs || 0)}</div></div> : <div><div className="font-medium">❌ Failed</div><div className="text-xs mt-1">{testResult.error}</div></div>}
                  </div>
                )}
              </div>
              {discoveredModels.length > 0 && (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Pilih Model ({selectedModels.length}/{discoveredModels.length})</label>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedModels([...discoveredModels])} className="text-xs text-indigo-600 hover:text-indigo-800">Pilih Semua</button>
                      <button onClick={() => setSelectedModels([])} className="text-xs text-slate-500 hover:text-slate-700">Hapus Semua</button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {discoveredModels.map(model => (
                      <label key={model} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={selectedModels.includes(model)} onChange={() => toggleModel(model)} className="rounded border-slate-300 text-indigo-600" />
                        <span className="text-sm font-mono text-slate-700">{model}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowProviderModal(false); resetProviderForm(); }} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={handleSaveProvider} disabled={discoveredModels.length === 0 || selectedModels.length === 0} className="btn btn-primary flex-1">{editingProvider ? '💾 Update' : '+ Tambah'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Create Combo Modal ─────────────────── */}
      {showComboModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Buat Combo Model</h3>
                <button onClick={() => setShowComboModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div>
                <label className="text-sm text-slate-600">Nama Combo</label>
                <input type="text" className="input mt-1" placeholder="e.g. gpt-4-combo, fast-mix" value={comboForm.name} onChange={e => setComboForm(f => ({ ...f, name: e.target.value }))} />
                <p className="text-xs text-slate-400 mt-1">Nama ini yang dipakai sebagai model di request API</p>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-slate-700">Provider + Model ({comboItems.length})</label>
                  <button onClick={addComboItem} className="text-xs text-indigo-600 hover:text-indigo-800">+ Tambah Item</button>
                </div>
                <div className="space-y-3">
                  {comboItems.map((item, i) => {
                    const provider = providers.find(p => p.id === item.providerId);
                    const availableModels = provider ? provider.selectedModels : [];
                    return (
                      <div key={i} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <select className="input" value={item.providerId} onChange={e => updateComboItem(i, 'providerId', e.target.value)}>
                            <option value="">Pilih Provider...</option>
                            {providers.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="flex-1">
                          <select className="input" value={item.model} onChange={e => updateComboItem(i, 'model', e.target.value)}>
                            <option value="">Pilih Model...</option>
                            {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <button onClick={() => removeComboItem(i)} className="text-xs px-2 py-2 rounded bg-red-50 text-red-600 hover:bg-red-100">✕</button>
                      </div>
                    );
                  })}
                </div>
                {comboItems.length === 0 && <div className="text-center py-4 text-slate-400 text-sm">Klik "+ Tambah Item" untuk mulai</div>}
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowComboModal(false)} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={handleSaveCombo} disabled={comboItems.length === 0 || !comboForm.name.trim()} className="btn btn-primary flex-1">🧩 Buat Combo</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
