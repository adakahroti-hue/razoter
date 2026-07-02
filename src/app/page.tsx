import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-8 max-w-2xl mx-auto px-4">
        <div className="space-y-4">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
            Razoter
          </h1>
          <p className="text-xl text-slate-600">
            OpenAI-compatible API proxy & router
          </p>
          <p className="text-slate-500">
            Merge multiple API endpoints into one with automatic failover, round-robin, and priority-based routing.
          </p>
        </div>
        
        <div className="flex gap-4 justify-center">
          <Link
            href="/dashboard"
            className="btn btn-primary text-lg px-8 py-3"
          >
            Open Dashboard
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-6 text-sm">
          <div className="card text-center">
            <div className="text-2xl mb-2">🔄</div>
            <h3 className="font-semibold text-slate-900">Failover</h3>
            <p className="text-slate-500 mt-1">Auto-switch on error</p>
          </div>
          <div className="card text-center">
            <div className="text-2xl mb-2">⚡</div>
            <h3 className="font-semibold text-slate-900">Round-Robin</h3>
            <p className="text-slate-500 mt-1">Even distribution</p>
          </div>
          <div className="card text-center">
            <div className="text-2xl mb-2">📊</div>
            <h3 className="font-semibold text-slate-900">Priority</h3>
            <p className="text-slate-500 mt-1">Priority-based routing</p>
          </div>
        </div>

        <div className="mt-8 text-xs text-slate-600 font-mono bg-slate-100 rounded-lg p-4">
          <p className="text-slate-500 mb-2">API Endpoint:</p>
          <p>POST /api/v1/chat/completions</p>
        </div>
      </div>
    </main>
  );
}
