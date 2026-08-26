import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, RefreshCcw, TerminalSquare } from 'lucide-react';

function TerminalView({ pin, activeProject }) {
  const [status, setStatus] = useState('stopped'); // running, stopped
  const [logs, setLogs] = useState([]);
  const [command, setCommand] = useState('npm run dev');
  const [isPolling, setIsPolling] = useState(false);
  const logEndRef = useRef(null);

  const fetchStatus = () => {
    fetch(`/api/dev/status?project_name=${activeProject}`, {
      headers: { 'Authorization': `Bearer ${pin}` }
    })
    .then(res => res.json())
    .then(data => {
      setStatus(data.status);
      if (data.command) setCommand(data.command);
    })
    .catch(console.error);
  };

  const fetchLogs = () => {
    fetch(`/api/dev/logs?project_name=${activeProject}&count=100`, {
      headers: { 'Authorization': `Bearer ${pin}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.logs && data.logs.length > 0) {
        setLogs(prev => {
          const newLogs = [...prev, ...data.logs];
          return newLogs.slice(-500); // keep last 500 lines
        });
      }
    })
    .catch(console.error);
  };

  useEffect(() => {
    fetchStatus();
    setLogs([]); // clear logs on project change
  }, [activeProject]);

  useEffect(() => {
    let interval;
    if (status === 'running') {
      setIsPolling(true);
      interval = setInterval(() => {
        fetchStatus();
        fetchLogs();
      }, 1000);
    } else {
      setIsPolling(false);
    }
    return () => clearInterval(interval);
  }, [status, activeProject]);

  useEffect(() => {
    // Auto scroll
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView();
    }
  }, [logs]);

  const handleStart = () => {
    fetch('/api/dev/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pin}`
      },
      body: JSON.stringify({ project_name: activeProject, command })
    })
    .then(() => {
      setLogs([{ text: `> ${command}\n`, type: 'info' }]);
      setStatus('running');
    })
    .catch(console.error);
  };

  const handleStop = () => {
    fetch('/api/dev/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pin}`
      },
      body: JSON.stringify({ project_name: activeProject })
    })
    .then(() => setStatus('stopped'))
    .catch(console.error);
  };

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Toolbar */}
      <div className="h-14 bg-dark-900 border-b border-dark-800 flex items-center px-4 gap-3 shrink-0">
        <div className="flex-1 max-w-sm flex items-center bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
          <div className="px-3 text-slate-500 font-mono font-bold">{">"}</div>
          <input 
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={status === 'running'}
            className="w-full bg-transparent border-none py-2 text-sm font-mono focus:outline-none text-slate-300 disabled:opacity-50"
            placeholder="npm run dev"
          />
        </div>
        
        {status === 'running' ? (
          <button onClick={handleStop} className="w-10 h-10 flex items-center justify-center bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors shrink-0">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button onClick={handleStart} className="w-10 h-10 flex items-center justify-center bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-colors shrink-0">
            <Play size={16} fill="currentColor" />
          </button>
        )}
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-slate-300">
        {logs.length === 0 && status !== 'running' && (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50">
            <TerminalSquare size={48} className="mb-4" />
            <p>Server not running</p>
          </div>
        )}
        
        {logs.map((log, i) => (
          <div key={i} className="whitespace-pre-wrap break-all mb-1">
            {typeof log === 'string' ? log : log.text}
          </div>
        ))}
        {status === 'running' && (
          <div className="flex items-center gap-2 mt-2 text-brand-500">
            <RefreshCcw size={12} className="animate-spin" />
            <span>Polling...</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

export default TerminalView;
