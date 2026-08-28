import React, { useState, useEffect } from 'react';
import {
  Folder, File, ChevronRight, ChevronDown, Cpu, Bot, Boxes,
  Gauge, Shield, Bug, Lightbulb, PenTool, CheckCircle, FileCode2
} from 'lucide-react';

const ENGINES = [
  {
    id: 'antigravity',
    name: 'AntiGravity',
    description: 'Built-in agent personas with project-aware logic',
    icon: Boxes,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Real CLI agent wired to your local opencode install',
    icon: Bot,
  },
];

export function EngineSelector({ token, engine, onEngineChange, agent, onAgentChange, model, onModelChange }) {
  const [agents, setAgents] = useState({ antigravity: [], opencode: [] });

  useEffect(() => {
    fetch('/ws/agents', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setAgents({
        antigravity: data.antigravity || [],
        opencode: data.opencode || [],
      }))
      .catch(() => {});
  }, [token]);

  const currentAgents = agents[engine] || [];
  const active = currentAgents.find(a => a.id === agent) || currentAgents[0];
  const activeModel = model || (engine === 'opencode' ? agents.opencode[0]?.id : '');

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl p-3 space-y-3">
      {/* Engine toggle */}
      <div className="grid grid-cols-2 gap-2">
        {ENGINES.map(e => {
          const Icon = e.icon;
          const isActive = engine === e.id;
          return (
            <button
              key={e.id}
              onClick={() => onEngineChange(e.id)}
              className={`p-2 rounded-lg border text-left transition-colors ${isActive ? 'bg-brand-500/15 border-brand-500' : 'bg-dark-900 border-dark-700 hover:border-dark-500'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className={isActive ? 'text-brand-400' : 'text-slate-400'} />
                <span className="text-sm font-semibold">{e.name}</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">{e.description}</p>
            </button>
          );
        })}
      </div>

      {engine === 'antigravity' && (
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1.5">
            AntiGravity Agent
          </label>
          <div className="space-y-1.5">
            {agents.antigravity.map(a => {
              const selected = a.id === (active?.id);
              return (
                <button
                  key={a.id}
                  onClick={() => onAgentChange(a.id)}
                  className={`w-full p-2 rounded-lg border flex items-start gap-2 text-left transition-colors ${selected ? 'bg-brand-500/15 border-brand-500' : 'bg-dark-900 border-dark-700 hover:border-dark-500'}`}
                >
                  <span className={`mt-0.5 ${selected ? 'text-brand-400' : 'text-slate-400'}`}>
                    <IconForAgent a={a.id} />
                  </span>
                  <span>
                    <span className="block text-xs font-semibold">{a.name}</span>
                    <span className="block text-[10px] text-slate-500">{a.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {engine === 'opencode' && (
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1.5">
            OpenCode Model
          </label>
          <select
            value={activeModel}
            onChange={e => onModelChange(e.target.value)}
            className="w-full bg-dark-900 border border-dark-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-brand-500 outline-none"
          >
            <option value="">Auto (default)</option>
            {agents.opencode.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {agents.opencode.length === 0 && (
            <p className="text-[10px] text-amber-400 mt-1">No opencode models found — will use default model.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function UsageMeter({ engine, agent }) {
  // Simulated usage/quota metrics (real limits come from provider billing).
  if (engine === 'antigravity') {
    return (
      <div className="bg-dark-800 border border-dark-700 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <Gauge size={14} className="text-brand-400" />
          <span className="text-xs font-semibold">AntiGravity Agent Usage</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Daily limit</span><span className="text-brand-400">Unlimited</span>
            </div>
            <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">Built-in agents run locally — no quota limits on this engine.</p>
      </div>
    );
  }
  return (
    <div className="bg-dark-800 border border-dark-700 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <Gauge size={14} className="text-brand-400" />
        <span className="text-xs font-semibold">OpenCode Usage</span>
      </div>
      <p className="text-[10px] text-slate-500">Usage/cost metrics tracked by your opencode provider accounts. Run <code className="text-brand-400">opencode stats</code> for detailed numbers.</p>
    </div>
  );
}

function IconForAgent({ a }) {
  switch (a) {
    case 'code-fixer': return <Bug size={14} />;
    case 'code-explainer': return <Lightbulb size={14} />;
    case 'refactorer': return <PenTool size={14} />;
    case 'test-writer': return <CheckCircle size={14} />;
    case 'code-reviewer': return <Shield size={14} />;
    default: return <Cpu size={14} />;
  }
}

export function FileExplorer({ token, project, selectedFile, onSelectFile }) {
  const [tree, setTree] = useState({ items: [] });
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [content, setContent] = useState(null);

  const loadTree = (relPath = '') => {
    setLoading(true);
    setPath(relPath);
    fetch(`/api/projects/tree?project=${encodeURIComponent(project)}&path=${encodeURIComponent(relPath)}&depth=2`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { setTree(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadTree(''); setContent(null); }, [project, token]);

  const toggle = (item) => {
    if (item.is_dir) {
      setExpanded(prev => ({ ...prev, [item.path]: !prev[item.path] }));
    } else {
      onSelectFile(item.path);
      fetch(`/api/projects/content?project=${encodeURIComponent(project)}&path=${encodeURIComponent(item.path)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => setContent(d))
        .catch(() => setContent(null));
    }
  };

  const renderNode = (item, depth) => (
    <div key={item.path}>
      <button
        onClick={() => toggle(item)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-dark-700/50 rounded text-left transition-colors"
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {item.is_dir ? (
          expanded[item.path] ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />
        ) : (
          <span className="w-[13px]" />
        )}
        {item.is_dir
          ? <Folder size={14} className="text-brand-400" />
          : <File size={14} className="text-slate-500" />}
        <span className={`text-sm truncate ${selectedFile === item.path ? 'text-brand-400' : 'text-slate-300'}`}>
          {item.name}
        </span>
      </button>
      {item.is_dir && expanded[item.path] && item.children && (
        item.children.map(child => renderNode(child, depth + 1))
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-dark-800">
        <div className="flex items-center gap-2">
          <FileCode2 size={14} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-400">Explorer</span>
        </div>
        <span className="text-[10px] text-slate-600 font-mono truncate max-w-[120px]">{path || '/'}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {loading && <p className="text-xs text-slate-500 p-2">Loading...</p>}
        {tree.items.map(item => renderNode(item, 0))}
      </div>
      {selectedFile && (
        <div className="border-t border-dark-800">
          <div className="px-3 py-1.5 border-b border-dark-800 flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-500 truncate">{selectedFile}</span>
            <button onClick={() => onSelectFile('')} className="text-slate-500 hover:text-white text-xs px-1">✕</button>
          </div>
          {content ? (
            <pre className="h-40 overflow-auto p-3 text-[10px] font-mono text-slate-300 leading-relaxed">
              {content.content}
            </pre>
          ) : (
            <div className="h-40 overflow-auto p-3 text-[10px] font-mono text-slate-500">Select a file to view.</div>
          )}
        </div>
      )}
    </div>
  );
}
