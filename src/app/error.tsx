'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#05070f] text-slate-300 px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-xl font-bold text-slate-100">Terjadi kesalahan</h1>
        <p className="text-sm text-slate-400">
          Dashboard mengalami error. Coba muat ulang, atau periksa koneksi internet kamu.
        </p>
        {error?.message && (
          <pre className="text-xs text-red-400/80 bg-red-950/20 border border-red-900/30 rounded-lg p-3 overflow-x-auto text-left">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
          >
            Coba lagi
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors"
          >
            Muat ulang halaman
          </button>
        </div>
      </div>
    </div>
  );
}
