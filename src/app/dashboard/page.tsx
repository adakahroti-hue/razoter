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

// ─── Main Component ────────────────────────────────

export default function Dashboard() {
  // Auth state
  const [token, setTokenState] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);

  // Data state
  const [providers, setProviders] = useState<Provider[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<any>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<'providers' | 'logs' | 'settings'>('providers');
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  // Provider form state
  const [providerForm, setProviderForm] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
  });
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; latencyMs?: number; modelCount?: number } | null>(null);

  // API key state
  const [showApiKey, setShowApiKey] = useState(false);
  const [currentApiKey, setCurrentApiKey] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  // Settings form
  const [settingsForm, setSettingsForm] = useState({
    maxRetries: 3,
    timeoutMs: 30000,
  });

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
    if (res.status === 401) {
      clearToken();
      setTokenState(null);
      throw new Error('Unauthorized');
    }
    return res;
  }, [token]);

  // ─── Data fetching ───────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [provRes, logRes, statsRes, configRes] = await Promise.all([
        api('/api/providers'),
        api('/api/logs?limit=50'),
        api('/api/stats'),
        api('/api/config'),
      ]);

      if (provRes.ok) setProviders(await provRes.json());
      if (logRes.ok) {
        const logData = await logRes.json();
        setLogs(logData.logs || logData);
      }
      if (statsRes.ok) setStats(await statsRes.json());
      if (configRes.ok) {
        const c = await configRes.json();
        setConfig(c);
        setSettingsForm({ maxRetries: c.maxRetries, timeoutMs: c.timeoutMs });
      }
    } catch (e) {
      console.error('Fetch error:', e);
    }
  }, [api]);

  useEffect(() => {
    const t = getToken();
    if (t) {
      setTokenState(t);
      fetchData();
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [token, fetchData]);

  // ─── Auth handlers ───────────────────────────────

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
      if (!res.ok) {
        setLoginError(data.error || 'Login failed');
        return;
      }
      setToken(data.token);
      setTokenState(data.token);
    } catch {
      setLoginError('Network error');
    }
  }

  function handleLogout() {
    clearToken();
    setTokenState(null);
  }

  // ─── Provider actions ────────────────────────────

  async function handleTestConnection() {
    if (!providerForm.baseUrl || !providerForm.apiKey) return;
    setTestingConnection(true);
    setTestResult(null);
    setDiscoveredModels([]);
    setSelectedModels([]);

    try {
      const res = await api('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey,
        }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success && data.models) {
        setDiscoveredModels(data.models);
        // If editing, keep existing selections; otherwise select all
        if (editingProvider) {
          const existing = editingProvider.selectedModels.filter(m => data.models.includes(m));
          setSelectedModels(existing.length > 0 ? existing : data.models);
        } else {
          setSelectedModels(data.models);
        }
      }
    } catch {
      setTestResult({ success: false, error: 'Network error' });
    } finally {
      setTestingConnection(false);
    }
  }

  function toggleModel(model: string) {
    setSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    );
  }

  function selectAllModels() {
    setSelectedModels([...discoveredModels]);
  }

  function deselectAllModels() {
    setSelectedModels([]);
  }

  async function handleSaveProvider() {
    if (!providerForm.name || !providerForm.baseUrl || !providerForm.apiKey) return;
    if (discoveredModels.length === 0) {
      alert('Test connection dulu untuk discover models!');
      return;
    }
    if (selectedModels.length === 0) {
      alert('Pilih minimal 1 model!');
      return;
    }

    try {
      const body = {
        name: providerForm.name,
        baseUrl: providerForm.baseUrl,
        apiKey: providerForm.apiKey,
        models: discoveredModels,
        selectedModels,
        priority: 10,
        enabled: true,
      };

      let res;
      if (editingProvider) {
        res = await api('/api/providers', {
          method: 'PUT',
          body: JSON.stringify({ id: editingProvider.id, ...body }),
        });
      } else {
        res = await api('/api/providers', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        setShowProviderModal(false);
        resetProviderForm();
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to save provider');
      }
    } catch {
      alert('Network error');
    }
  }

  async function handleDeleteProvider(id: string) {
    if (!confirm('Hapus provider ini?')) return;
    try {
      await api(`/api/providers?id=${id}`, { method: 'DELETE' });
      fetchData();
    } catch {}
  }

  async function handleToggleProvider(provider: Provider) {
    try {
      await api('/api/providers', {
        method: 'PUT',
        body: JSON.stringify({ id: provider.id, enabled: !provider.enabled }),
      });
      fetchData();
    } catch {}
  }

  function openEditModal(provider: Provider) {
    setEditingProvider(provider);
    setProviderForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey, // This is masked, but we'll keep it
    });
    setDiscoveredModels(provider.models);
    setSelectedModels(provider.selectedModels);
    setTestResult(null);
    setShowProviderModal(true);
  }

  function resetProviderForm() {
    setProviderForm({ name: '', baseUrl: '', apiKey: '' });
    setDiscoveredModels([]);
    setSelectedModels([]);
    setTestResult(null);
    setEditingProvider(null);
  }

  // ─── Settings actions ────────────────────────────

  async function handleChangeMode(mode: string) {
    try {
      await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      });
      fetchData();
    } catch {}
  }

  async function handleSaveSettings() {
    try {
      await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify(settingsForm),
      });
      fetchData();
    } catch {}
  }

  async function handleGenerateApiKey() {
    try {
      const res = await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ action: 'regenerate_key' }),
      });
      const data = await res.json();
      if (data.apiKey) {
        setGeneratedKey(data.apiKey);
      }
      fetchData();
    } catch {}
  }

  async function handleChangeApiKey() {
    if (!currentApiKey || !newApiKey) return;
    try {
      const res = await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ action: 'change_key', currentKey: currentApiKey, newKey: newApiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentApiKey('');
        setNewApiKey('');
        alert('API key berhasil diubah!');
      } else {
        alert(data.error || 'Gagal mengubah API key');
      }
    } catch {
      alert('Network error');
    }
  }

  async function handleHealthCheck() {
    try {
      await api('/api/health');
      fetchData();
    } catch {}
  }

  async function handleClearLogs() {
    if (!confirm('Hapus semua logs?')) return;
    try {
      await api('/api/logs', { method: 'DELETE' });
      fetchData();
    } catch {}
  }

  // ─── UI helpers ──────────────────────────────────

  function healthBadge(status: string) {
    const colors: Record<string, string> = {
      healthy: 'bg-emerald-100 text-emerald-700',
      degraded: 'bg-amber-100 text-amber-700',
      down: 'bg-red-100 text-red-700',
      unknown: 'bg-slate-100 text-slate-500',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.unknown}`}>
        {status}
      </span>
    );
  }

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      success: 'bg-emerald-100 text-emerald-700',
      error: 'bg-red-100 text-red-700',
      timeout: 'bg-amber-100 text-amber-700',
      retry: 'bg-blue-100 text-blue-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-slate-100 text-slate-500'}`}>
        {status}
      </span>
    );
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleString('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function formatLatency(ms: number) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  // ─── Login screen ────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="pulse-dot text-4xl">⏳</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <form onSubmit={handleLogin} className="card w-full max-w-sm space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-900">Razoter</h1>
            <p className="text-sm text-slate-500 mt-1">Dashboard Login</p>
          </div>
          {loginError && (
            <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm">{loginError}</div>
          )}
          <input
            type="text"
            placeholder="Username"
            className="input"
            value={loginForm.username}
            onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
          />
          <input
            type="password"
            placeholder="Password"
            className="input"
            value={loginForm.password}
            onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
          />
          <button type="submit" className="btn btn-primary w-full">Login</button>
        </form>
      </div>
    );
  }

  // ─── Dashboard UI ────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">Razoter</h1>
            <span className="text-xs text-slate-400">v2.0</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleHealthCheck} className="btn btn-secondary text-sm">
              🏥 Health Check
            </button>
            <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-red-600">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <div className="card text-center">
              <div className="text-2xl font-bold text-slate-900">{stats.totalRequests}</div>
              <div className="text-xs text-slate-500">Total Requests</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-emerald-600">{stats.successRate}%</div>
              <div className="text-xs text-slate-500">Success Rate</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-slate-900">{formatLatency(stats.avgLatency)}</div>
              <div className="text-xs text-slate-500">Avg Latency</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-slate-900">{providers.length}</div>
              <div className="text-xs text-slate-500">Providers</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['providers', 'logs', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'providers' ? '🔌 Providers' : tab === 'logs' ? '📋 Logs' : '⚙️ Settings'}
            </button>
          ))}
        </div>

        {/* Providers Tab */}
        {activeTab === 'providers' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900">Providers</h2>
              <button
                onClick={() => { resetProviderForm(); setShowProviderModal(true); }}
                className="btn btn-primary"
              >
                + Add Provider
              </button>
            </div>

            {providers.length === 0 ? (
              <div className="card text-center py-12 text-slate-400">
                <div className="text-4xl mb-2">🔌</div>
                <p>Belum ada provider. Tambah provider pertama!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map(p => (
                  <div key={p.id} className="card">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-slate-900">{p.name}</h3>
                          {healthBadge(p.healthStatus)}
                          {!p.enabled && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-500">
                              disabled
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono">{p.baseUrl}</div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {p.selectedModels.map(m => (
                            <span key={m} className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs font-mono">
                              {m}
                            </span>
                          ))}
                          {p.selectedModels.length < p.models.length && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-400 text-xs">
                              +{p.models.length - p.selectedModels.length} more
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-slate-500">
                          <span>📊 {p.totalRequests} req</span>
                          <span>✅ {p.successCount} ok</span>
                          <span>❌ {p.errorCount} err</span>
                          <span>⚡ {formatLatency(p.avgLatencyMs)} avg</span>
                          {p.rateLimitRemaining !== null && (
                            <span>🚦 {p.rateLimitRemaining}/{p.rateLimitTotal} remaining</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleProvider(p)}
                          className={`text-xs px-2 py-1 rounded ${p.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                        >
                          {p.enabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          onClick={() => openEditModal(p)}
                          className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(p.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-900">Request Logs</h2>
              <button onClick={handleClearLogs} className="btn btn-secondary text-sm">
                🗑️ Clear Logs
              </button>
            </div>

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-2 text-slate-500 font-medium">Time</th>
                    <th className="px-4 py-2 text-slate-500 font-medium">Provider</th>
                    <th className="px-4 py-2 text-slate-500 font-medium">Model</th>
                    <th className="px-4 py-2 text-slate-500 font-medium">Status</th>
                    <th className="px-4 py-2 text-slate-500 font-medium">Latency</th>
                    <th className="px-4 py-2 text-slate-500 font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        Belum ada logs
                      </td>
                    </tr>
                  ) : (
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
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* Rotation Mode */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">🔄 Rotation Mode</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { mode: 'failover', label: 'Failover', desc: 'Gagal → switch ke provider lain', icon: '🔄' },
                  { mode: 'round-robin', label: 'Round Robin', desc: 'Rotasi merata antar provider', icon: '⚡' },
                  { mode: 'priority', label: 'Priority', desc: 'Provider prioritas lebih tinggi dipilih duluan', icon: '📊' },
                ].map(m => (
                  <button
                    key={m.mode}
                    onClick={() => handleChangeMode(m.mode)}
                    className={`p-4 rounded-lg border-2 text-left transition-colors ${
                      config?.mode === m.mode
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-lg mb-1">{m.icon}</div>
                    <div className="font-medium text-slate-900">{m.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Retry & Timeout */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">⚙️ Retry & Timeout</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-600">Max Retries</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="input mt-1"
                    value={settingsForm.maxRetries}
                    onChange={e => setSettingsForm(f => ({ ...f, maxRetries: parseInt(e.target.value) || 3 }))}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">Timeout (ms)</label>
                  <input
                    type="number"
                    min={5000}
                    max={120000}
                    step={1000}
                    className="input mt-1"
                    value={settingsForm.timeoutMs}
                    onChange={e => setSettingsForm(f => ({ ...f, timeoutMs: parseInt(e.target.value) || 30000 }))}
                  />
                </div>
              </div>
              <button onClick={handleSaveSettings} className="btn btn-primary mt-4">
                💾 Simpan Settings
              </button>
            </div>

            {/* API Key Management */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">🔑 API Key Razoter</h3>
              <p className="text-sm text-slate-500 mb-4">
                API key ini dipakai untuk menghubungkan Razoter ke platform tujuan (Cursor, Open WebUI, dll).
              </p>
              
              {config && (
                <div className="bg-slate-50 rounded-lg p-3 mb-4">
                  <div className="text-xs text-slate-500 mb-1">Current Key:</div>
                  <code className="text-sm text-slate-700 font-mono">{config.apiKeyMasked}</code>
                </div>
              )}

              {/* Generate new key */}
              <div className="space-y-3">
                <button onClick={handleGenerateApiKey} className="btn btn-primary w-full">
                  🎲 Generate API Key Baru
                </button>
                {generatedKey && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <div className="text-sm font-medium text-emerald-800 mb-2">✅ API Key baru:</div>
                    <code className="text-sm text-emerald-700 font-mono break-all">{generatedKey}</code>
                    <div className="text-xs text-emerald-600 mt-2">
                      ⚠️ Copy sekarang! Tidak akan ditampilkan lagi.
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(generatedKey)}
                      className="btn btn-secondary text-xs mt-2"
                    >
                      📋 Copy
                    </button>
                  </div>
                )}

                <div className="border-t border-slate-200 pt-3">
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    {showApiKey ? '🔼 Sembunyikan' : '🔽 Ubah API Key Manual'}
                  </button>
                  {showApiKey && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="password"
                        placeholder="Current API Key"
                        className="input"
                        value={currentApiKey}
                        onChange={e => setCurrentApiKey(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="New API Key"
                        className="input"
                        value={newApiKey}
                        onChange={e => setNewApiKey(e.target.value)}
                      />
                      <button onClick={handleChangeApiKey} className="btn btn-secondary w-full text-sm">
                        Ubah API Key
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* API Endpoint Info */}
            <div className="card">
              <h3 className="font-semibold text-slate-900 mb-3">📡 Endpoint Info</h3>
              <div className="bg-slate-50 rounded-lg p-4 font-mono text-sm space-y-2">
                <div>
                  <span className="text-slate-500">Base URL:</span>{' '}
                  <span className="text-slate-700">https://razoter.vercel.app</span>
                </div>
                <div>
                  <span className="text-slate-500">Endpoint:</span>{' '}
                  <span className="text-slate-700">/api/v1/chat/completions</span>
                </div>
                <div>
                  <span className="text-slate-500">Auth:</span>{' '}
                  <span className="text-slate-700">Bearer &lt;your-api-key&gt;</span>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                <p className="font-medium mb-1">Cara pakai di platform lain:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Base URL: <code>https://razoter.vercel.app/v1</code></li>
                  <li>API Key: pakai key yang di-generate di atas</li>
                  <li>Model: bebas (akan di-redirect ke provider yang aktif)</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ─── Add/Edit Provider Modal ──────────────── */}
      {showProviderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">
                  {editingProvider ? 'Edit Provider' : 'Tambah Provider'}
                </h3>
                <button
                  onClick={() => { setShowProviderModal(false); resetProviderForm(); }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              {/* Basic Info */}
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-slate-600">Nama Provider</label>
                  <input
                    type="text"
                    className="input mt-1"
                    placeholder="e.g. OpenRouter, Together AI"
                    value={providerForm.name}
                    onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">Base URL</label>
                  <input
                    type="text"
                    className="input mt-1"
                    placeholder="https://openrouter.ai/api/v1"
                    value={providerForm.baseUrl}
                    onChange={e => setProviderForm(f => ({ ...f, baseUrl: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">API Key</label>
                  <input
                    type="password"
                    className="input mt-1"
                    placeholder="sk-..."
                    value={providerForm.apiKey}
                    onChange={e => setProviderForm(f => ({ ...f, apiKey: e.target.value }))}
                  />
                </div>
              </div>

              {/* Test Connection */}
              <div className="border-t border-slate-200 pt-4">
                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection || !providerForm.baseUrl || !providerForm.apiKey}
                  className="btn btn-primary w-full"
                >
                  {testingConnection ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="pulse-dot">⏳</span> Testing...
                    </span>
                  ) : (
                    '🔌 Test Connection & Discover Models'
                  )}
                </button>

                {testResult && (
                  <div className={`mt-3 p-3 rounded-lg text-sm ${
                    testResult.success
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-700'
                  }`}>
                    {testResult.success ? (
                      <div>
                        <div className="font-medium">✅ Connected!</div>
                        <div className="text-xs mt-1">
                          {testResult.modelCount} models ditemukan • {formatLatency(testResult.latencyMs || 0)}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium">❌ Failed</div>
                        <div className="text-xs mt-1">{testResult.error}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Model Selector */}
              {discoveredModels.length > 0 && (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Pilih Model ({selectedModels.length}/{discoveredModels.length})
                    </label>
                    <div className="flex gap-2">
                      <button onClick={selectAllModels} className="text-xs text-indigo-600 hover:text-indigo-800">
                        Pilih Semua
                      </button>
                      <button onClick={deselectAllModels} className="text-xs text-slate-500 hover:text-slate-700">
                        Hapus Semua
                      </button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {discoveredModels.map(model => (
                      <label
                        key={model}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(model)}
                          onChange={() => toggleModel(model)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span className="text-sm font-mono text-slate-700">{model}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowProviderModal(false); resetProviderForm(); }}
                  className="btn btn-secondary flex-1"
                >
                  Batal
                </button>
                <button
                  onClick={handleSaveProvider}
                  disabled={discoveredModels.length === 0 || selectedModels.length === 0}
                  className="btn btn-primary flex-1"
                >
                  {editingProvider ? '💾 Update' : '+ Tambah'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
