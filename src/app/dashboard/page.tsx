'use client';

import { useState, useEffect, useCallback } from 'react';

const API_KEY = 'razoter-default-key-change-me';

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  lastUsed?: string;
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  healthStatus: string;
}

interface RequestLog {
  id: string;
  timestamp: string;
  providerId: string;
  providerName: string;
  model: string;
  status: string;
  statusCode?: number;
  latencyMs: number;
  errorMessage?: string;
  tokensUsed?: number;
}

interface Stats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  providerBreakdown: {
    providerId: string;
    providerName: string;
    requests: number;
    successes: number;
    errors: number;
    avgLatency: number;
  }[];
}

const api = async (path: string, options?: RequestInit) => {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      ...options?.headers,
    },
  });
  return res.json();
};

export default function Dashboard() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mode, setMode] = useState<string>('failover');
  const [activeTab, setActiveTab] = useState<'providers' | 'logs' | 'settings'>('providers');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxRetries, setMaxRetries] = useState(3);
  const [timeoutMs, setTimeoutMs] = useState(30000);

  // Form state
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    priority: 10,
    enabled: true,
  });

  const fetchData = useCallback(async () => {
    try {
      const [providersRes, logsRes, statsRes, configRes] = await Promise.all([
        api('/api/providers'),
        api('/api/logs'),
        api('/api/stats'),
        api('/api/config'),
      ]);
      setProviders(providersRes);
      setLogs(logsRes.logs || []);
      setStats(statsRes);
      if (configRes.mode) {
        setMode(configRes.mode);
        setMaxRetries(configRes.maxRetries || 3);
        setTimeoutMs(configRes.timeoutMs || 30000);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSaveProvider = async () => {
    if (!form.name || !form.baseUrl || !form.apiKey || !form.model) {
      alert('Please fill all required fields');
      return;
    }

    if (editingProvider) {
      await api('/api/providers', {
        method: 'PUT',
        body: JSON.stringify({ id: editingProvider.id, ...form }),
      });
    } else {
      await api('/api/providers', {
        method: 'POST',
        body: JSON.stringify(form),
      });
    }

    setShowAddModal(false);
    setEditingProvider(null);
    resetForm();
    fetchData();
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm('Delete this provider?')) return;
    await api(`/api/providers?id=${id}`, { method: 'DELETE' });
    fetchData();
  };

  const handleToggleProvider = async (provider: Provider) => {
    await api('/api/providers', {
      method: 'PUT',
      body: JSON.stringify({ id: provider.id, enabled: !provider.enabled }),
    });
    fetchData();
  };

  const handleChangeMode = async (newMode: string) => {
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ mode: newMode }),
    });
    setMode(newMode);
  };

  const handleUpdateConfig = async () => {
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ maxRetries, timeoutMs }),
    });
    fetchData();
  };

  const handleCheckHealth = async () => {
    setLoading(true);
    await api('/api/health');
    fetchData();
  };

  const handleClearLogs = async () => {
    if (!confirm('Clear all logs?')) return;
    await api('/api/logs', { method: 'DELETE' });
    fetchData();
  };

  const resetForm = () => {
    setForm({ name: '', baseUrl: '', apiKey: '', model: '', priority: 10, enabled: true });
  };

  const startEdit = (provider: Provider) => {
    setEditingProvider(provider);
    setForm({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      model: provider.model,
      priority: provider.priority,
      enabled: provider.enabled,
    });
    setShowAddModal(true);
  };

  const getHealthBadge = (status: string) => {
    const classes: Record<string, string> = {
      healthy: 'bg-green-500/20 text-green-400',
      degraded: 'bg-yellow-500/20 text-yellow-400',
      down: 'bg-red-500/20 text-red-400',
      unknown: 'bg-gray-500/20 text-gray-400',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${classes[status] || classes.unknown}`}>{status}</span>;
  };

  const getStatusBadge = (status: string) => {
    const classes: Record<string, string> = {
      success: 'bg-green-500/20 text-green-400',
      error: 'bg-red-500/20 text-red-400',
      timeout: 'bg-yellow-500/20 text-yellow-400',
      retry: 'bg-blue-500/20 text-blue-400',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${classes[status] || ''}`}>{status}</span>;
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading && providers.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Razoter
            </h1>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
              v1.0
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">
              {providers.filter(p => p.enabled).length} active
            </span>
            <button onClick={fetchData} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-3xl font-bold text-indigo-400">{stats?.totalRequests || 0}</div>
            <div className="text-sm text-gray-500 mt-1">Total Requests</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-3xl font-bold text-green-400">{stats?.successRate || 0}%</div>
            <div className="text-sm text-gray-500 mt-1">Success Rate</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-3xl font-bold text-yellow-400">{formatTime(stats?.avgLatency || 0)}</div>
            <div className="text-sm text-gray-500 mt-1">Avg Latency</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-3xl font-bold text-purple-400">{providers.length}</div>
            <div className="text-sm text-gray-500 mt-1">Providers</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900 p-1 rounded-xl w-fit">
          {(['providers', 'logs', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {tab === 'providers' && '⚙️ Providers'}
              {tab === 'logs' && '📋 Request Logs'}
              {tab === 'settings' && '🔧 Settings'}
            </button>
          ))}
        </div>

        {/* Providers Tab */}
        {activeTab === 'providers' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">API Providers</h2>
              <div className="flex gap-2">
                <button onClick={handleCheckHealth} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
                  🏥 Check Health
                </button>
                <button onClick={() => { resetForm(); setEditingProvider(null); setShowAddModal(true); }} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm text-white transition-colors">
                  + Add Provider
                </button>
              </div>
            </div>

            {providers.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl text-center py-12 text-gray-500">
                <p className="text-lg mb-2">No providers configured</p>
                <p className="text-sm">Add your first API provider to get started</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {providers.map(provider => (
                  <div key={provider.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-3 h-3 rounded-full ${
                        provider.enabled ? 'bg-green-500' : 'bg-gray-600'
                      }`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-200">{provider.name}</span>
                          {getHealthBadge(provider.healthStatus)}
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5 flex gap-4">
                          <span>{provider.model}</span>
                          <span className="text-gray-600">•</span>
                          <span className="font-mono text-xs">{provider.baseUrl}</span>
                          <span className="text-gray-600">•</span>
                          <span>Priority: {provider.priority}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right text-sm">
                        <div className="text-gray-300">{provider.requestCount} reqs</div>
                        <div className="text-gray-500">{formatTime(provider.avgLatency)} avg</div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleToggleProvider(provider)}
                          className={`px-2 py-1 rounded text-xs ${
                            provider.enabled 
                              ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                              : 'bg-red-900/50 hover:bg-red-900/70 text-red-400'
                          }`}
                        >
                          {provider.enabled ? '✓' : '✗'}
                        </button>
                        <button onClick={() => startEdit(provider)} className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-300">
                          ✎
                        </button>
                        <button onClick={() => handleDeleteProvider(provider.id)} className="px-2 py-1 rounded text-xs bg-red-900/50 hover:bg-red-900/70 text-red-400">
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Provider Breakdown */}
            {stats?.providerBreakdown && stats.providerBreakdown.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mt-6">
                <h3 className="font-semibold mb-4 text-gray-300">Provider Breakdown</h3>
                <div className="grid grid-cols-3 gap-4">
                  {stats.providerBreakdown.map(pb => (
                    <div key={pb.providerId} className="bg-gray-800/50 rounded-lg p-4">
                      <div className="font-medium text-gray-200 mb-2">{pb.providerName}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Requests</span>
                          <span>{pb.requests}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Success</span>
                          <span className="text-green-400">{pb.successes}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Errors</span>
                          <span className="text-red-400">{pb.errors}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Avg Latency</span>
                          <span>{formatTime(pb.avgLatency)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Request Logs</h2>
              <button onClick={handleClearLogs} className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900/70 rounded-lg text-sm text-red-400 transition-colors">
                Clear Logs
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl text-center py-12 text-gray-500">
                <p>No requests logged yet</p>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-sm text-gray-400">
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Model</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Latency</th>
                      <th className="px-4 py-3">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-300">
                          {log.providerName}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {log.model}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {getStatusBadge(log.status)}
                            {log.statusCode && (
                              <span className="text-xs text-gray-600">{log.statusCode}</span>
                            )}
                          </div>
                          {log.errorMessage && (
                            <div className="text-xs text-red-400/70 mt-1 max-w-xs truncate">
                              {log.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {formatTime(log.latencyMs)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {log.tokensUsed || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-2xl">
            {/* Rotation Mode */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="font-semibold mb-4">Rotation Mode</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'failover', name: 'Failover', icon: '🔄', desc: 'Use primary, auto-switch on error' },
                  { id: 'round-robin', name: 'Round-Robin', icon: '⚡', desc: 'Distribute evenly across all' },
                  { id: 'priority', name: 'Priority', icon: '📊', desc: 'Use in priority order' },
                ].map(m => (
                  <div
                    key={m.id}
                    onClick={() => handleChangeMode(m.id)}
                    className={`p-4 rounded-xl cursor-pointer border transition-all ${
                      mode === m.id
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-2xl mb-2">{m.icon}</div>
                    <div className="font-semibold text-gray-200">{m.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="font-semibold mb-4">Advanced Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Max Retries</label>
                  <input
                    type="number"
                    value={maxRetries}
                    onChange={e => setMaxRetries(parseInt(e.target.value))}
                    min={1}
                    max={10}
                    className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Timeout (ms)</label>
                  <input
                    type="number"
                    value={timeoutMs}
                    onChange={e => setTimeoutMs(parseInt(e.target.value))}
                    min={5000}
                    max={120000}
                    step={1000}
                    className="w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button onClick={handleUpdateConfig} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm text-white transition-colors">
                  Save Settings
                </button>
              </div>
            </div>

            {/* API Info */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="font-semibold mb-4">API Endpoint</h3>
              <div className="bg-gray-800 rounded-lg p-4 font-mono text-sm">
                <p className="text-gray-400 mb-2">Use this endpoint with any OpenAI-compatible client:</p>
                <code className="text-indigo-400">POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/chat/completions</code>
                <p className="text-gray-500 mt-3 text-xs">
                  Set your Razoter API key as the Authorization: Bearer *** header
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">
                {editingProvider ? 'Edit Provider' : 'Add Provider'}
              </h3>
              <button onClick={() => { setShowAddModal(false); setEditingProvider(null); }} className="text-gray-500 hover:text-gray-300">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., OpenAI Production"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Base URL *</label>
                <input
                  type="text"
                  value={form.baseUrl}
                  onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  API Key * {editingProvider && <span className="text-gray-600">(leave empty to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={e => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Model *</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={e => setForm({ ...form, model: e.target.value })}
                  placeholder="gpt-4"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={e => setForm({ ...form, priority: parseInt(e.target.value) })}
                    min={1}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-xs text-gray-600 mt-1">Lower = higher priority</p>
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={e => setForm({ ...form, enabled: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-300">Enabled</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAddModal(false); setEditingProvider(null); }} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveProvider} className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm text-white transition-colors">
                {editingProvider ? 'Update' : 'Add'} Provider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
