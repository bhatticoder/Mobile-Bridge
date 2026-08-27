import React, { useState, useEffect, useRef } from 'react';
import { Wifi, Copy, Check, RefreshCw, Square, Terminal, LogOut } from 'lucide-react';
import QRCode from 'qrcode';

function ConnectionView({ token, onLogout }) {
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };

  const fetchStatus = () => {
    fetch('/api/tunnel/status', { headers })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Unauthorized')))
      .then(data => {
        setStatus(data.status);
        setUrl(data.url || '');
        if (data.message) setError(data.message);
        else setError('');
      })
      .catch(() => setError('Could not reach the hub connection service.'));
  };

  const fetchLogs = () => {
    fetch('/api/tunnel/logs?count=40', { headers })
      .then(r => r.ok ? r.json() : [])
      .then(data => setLogs(data.logs || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    const iv = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (url && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 220,
        margin: 2,
        color: { dark: '#0b101b', light: '#ffffff' }
      }).catch(() => {});
    }
  }, [url]);

  const act = (action) => {
    fetch(`/api/tunnel/${action}`, { method: 'POST', headers })
      .then(r => r.json())
      .then(() => { fetchStatus(); fetchLogs(); })
      .catch(() => setError('Action failed.'));
  };

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const badge = () => {
    if (status === 'active') return { text: 'Connected', cls: 'text-green-400 bg-green-500/15 border-green-500/40', spin: false };
    if (status === 'connecting') return { text: 'Connecting…', cls: 'text-amber-400 bg-amber-500/15 border-amber-500/40', spin: true };
    if (status === 'error') return { text: 'Not installed', cls: 'text-red-400 bg-red-500/15 border-red-500/40', spin: false };
    return { text: 'Stopped', cls: 'text-slate-400 bg-slate-500/15 border-slate-500/40', spin: false };
  };

  const b = badge();

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">Connection</h2>
        <button onClick={onLogout} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors">
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <div className="bg-dark-800 border border-dark-700 rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-slate-400">Internet tunnel</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${b.cls} flex items-center gap-1`}>
            {b.spin ? <RefreshCw size={12} className="animate-spin" /> : <Wifi size={12} />}
            {b.text}
          </span>
        </div>

        {url ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Scan with your phone</p>
              <button onClick={copy} className="text-left group">
                <p className="text-sm font-mono text-brand-400 break-all group-hover:underline">{url}</p>
              </button>
            </div>
            <canvas ref={canvasRef} className="w-[140px] h-[140px] bg-white rounded-xl shrink-0" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <p className="text-sm text-slate-400">Starting tunnel…</p>
        )}

        <div className="flex gap-2 mt-4">
          {status === 'active' || status === 'connecting' ? (
            <button onClick={() => act('stop')} className="flex-1 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 text-sm transition-colors flex items-center justify-center gap-1.5">
              <Square size={14} fill="currentColor" /> Stop tunnel
            </button>
          ) : (
            <button onClick={() => act('start')} className="flex-1 py-2 rounded-lg bg-brand-500 text-dark-900 hover:bg-brand-400 text-sm transition-colors flex items-center justify-center gap-1.5">
              <RefreshCw size={14} /> Start tunnel
            </button>
          )}
          {url && (
            <button onClick={copy} className="px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-sm transition-colors flex items-center gap-1.5">
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-dark-800/60 border border-dark-700 rounded-2xl p-3 mb-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          1. Open the URL (or scan the QR code) on your phone, sign in with your PIN.
          <br />
          2. The tunnel is protected by your PIN — treat the URL like a password.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Terminal size={14} className="text-slate-500" />
        <span className="text-xs text-slate-500">cloudflared log</span>
      </div>
      <div className="bg-dark-950 border border-dark-800 rounded-xl p-3 font-mono text-[11px] text-slate-400 h-48 overflow-y-auto whitespace-pre-wrap break-all">
        {logs.length === 0 ? <span className="opacity-50">No output yet.</span> : logs.join('\n')}
      </div>
    </div>
  );
}

export default ConnectionView;