import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, FolderOpen, History, X, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { EngineSelector, FileExplorer, UsageMeter } from '../components/EnginePanel';

function PromptConsole({ token, activeProject }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [wsError, setWsError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [engine, setEngine] = useState('antigravity');
  const [agent, setAgent] = useState('code-fixer');
  const [model, setModel] = useState('');
  const [showExplorer, setShowExplorer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  const buildWsUrl = (sid, e, a, m) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/prompt?project=${encodeURIComponent(activeProject)}` +
      `&token=${encodeURIComponent(token)}` +
      (sid ? `&session_id=${encodeURIComponent(sid)}` : '') +
      `&engine=${encodeURIComponent(e)}&agent=${encodeURIComponent(a)}&model=${encodeURIComponent(m)}`;
  };

  const connectWs = (sid, e, a, m) => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      wsRef.current.close();
    }
    setWsError('');
    setMessages([]);

    const wsUrl = buildWsUrl(sid, e, a, m);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setWsError('');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'history') {
        setSessionId(data.session_id);
        setMessages((data.messages || []).map(m => ({
          role: m.role, content: m.content, type: m.type,
          file: m.file_path, diff: m.diff,
        })));
      } else if (data.type === 'session_start' || data.session_id) {
        if (data.session_id) setSessionId(data.session_id);
      } else if (data.type === 'error') {
        if (/token/i.test(data.content)) setWsError(data.content);
        setMessages(prev => [...prev, { role: 'system', content: `Error: ${data.content}`, type: 'error' }]);
        setIsProcessing(false);
      } else if (data.type === 'thinking') {
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'agent' && lastMsg.type === 'thinking') {
            const newPrev = [...prev];
            newPrev[newPrev.length - 1] = { ...lastMsg, content: data.content };
            return newPrev;
          }
          return [...prev, { role: 'agent', content: data.content, type: 'thinking' }];
        });
      } else if (data.type === 'stdout' || data.type === 'stderr') {
        setMessages(prev => [...prev, { role: 'agent', content: data.content, type: 'terminal' }]);
      } else if (data.type === 'file_mod') {
        setMessages(prev => [...prev, { role: 'agent', file: data.file, diff: data.diff, type: 'diff' }]);
      } else if (data.type === 'done') {
        setMessages(prev => {
          const filtered = prev.filter(m => m.type !== 'thinking');
          return [...filtered, { role: 'agent', content: data.response, type: 'text' }];
        });
        setIsProcessing(false);
      }
    };

    ws.onclose = () => { wsRef.current = null; };
    wsRef.current = ws;
  };

  useEffect(() => {
    setSessionId('');
    setMessages([]);
    setSelectedFile('');
    connectWs('', engine, agent, model);
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [activeProject, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSessions = () => {
    fetch(`/api/sessions?project=${encodeURIComponent(activeProject)}&limit=30`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {});
  };

  const resumeSession = (sid) => {
    const s = sessions.find(x => x.id === sid);
    if (s) {
      setEngine(s.engine || 'antigravity');
      setAgent(s.agent || 'code-fixer');
      setModel(s.model || '');
      connectWs(sid, s.engine || 'antigravity', s.agent || 'code-fixer', s.model || '');
    }
    setShowHistory(false);
  };

  const newSession = () => {
    setSessionId('');
    setMessages([]);
    connectWs('', engine, agent, model);
    setShowHistory(false);
  };

  useEffect(() => { if (showHistory) loadSessions(); }, [showHistory, activeProject]);

  const sendPrompt = (text) => {
    if (!text.trim() || isProcessing) return;
    const attachment = selectedFile ? `\n\n[Attached file: ${selectedFile}]` : '';
    const full = text.trim() + attachment;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs(sessionId, engine, agent, model);
      setTimeout(() => sendPrompt(text), 600);
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: full, type: 'text' }]);
    wsRef.current.send(JSON.stringify({
      type: 'prompt', content: full, engine, agent, model,
    }));
    setInput('');
    setIsProcessing(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt(input);
    }
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar: engine/actions */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-dark-800 bg-dark-900/80 overflow-x-auto">
        <button
          onClick={() => { setShowExplorer(v => !v); setShowHistory(false); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${showExplorer ? 'bg-brand-500/15 text-brand-400 border border-brand-500' : 'bg-dark-800 text-slate-300 hover:text-white border border-dark-700'}`}
        >
          <FolderOpen size={13} /> Explorer
        </button>
        <button
          onClick={() => { setShowHistory(v => !v); setShowExplorer(false); loadSessions(); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${showHistory ? 'bg-brand-500/15 text-brand-400 border border-brand-500' : 'bg-dark-800 text-slate-300 hover:text-white border border-dark-700'}`}
        >
          <History size={13} /> History
        </button>
        <button
          onClick={newSession}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-dark-800 text-slate-300 hover:text-white border border-dark-700 whitespace-nowrap"
        >
          <X size={13} /> New session
        </button>
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-slate-500 truncate max-w-[150px]">
          {sessionId ? `session: ${sessionId}` : 'new session'}
        </span>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Side panel */}
        {(showExplorer || showHistory) && (
          <div className="w-64 shrink-0 border-r border-dark-800 bg-dark-900 flex flex-col min-h-0">
            {showExplorer && (
              <FileExplorer token={token} project={activeProject} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
            )}
            {showHistory && (
              <div className="flex flex-col h-full">
                <div className="px-3 py-2 border-b border-dark-800 text-xs font-semibold text-slate-400">Sessions</div>
                <div className="flex-1 overflow-y-auto">
                  {sessions.length === 0 && <p className="text-xs text-slate-500 p-3">No saved sessions yet.</p>}
                  {sessions.map(s => (
                    <button
                      key={s.id}
                      onClick={() => resumeSession(s.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-dark-800 border-b border-dark-800/50 ${s.id === sessionId ? 'bg-brand-500/10' : ''}`}
                    >
                      <span className="block text-xs font-medium text-slate-300 truncate">
                        {s.title || `${s.project} · ${s.engine}`}
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        {s.agent} · {new Date(s.updated_at * 1000).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Engine & settings (compact) */}
          <div className="shrink-0 px-3 pt-2 pb-1">
            <EngineSelector
              token={token}
              engine={engine}
              onEngineChange={(e) => { setEngine(e); if (e === 'opencode' && !model) setModel(''); }}
              agent={agent}
              onAgentChange={setAgent}
              model={model}
              onModelChange={setModel}
            />
            {selectedFile && (
              <div className="mt-2 flex items-center gap-2 bg-brand-500/10 border border-brand-500/30 rounded-lg px-3 py-1.5">
                <FolderOpen size={13} className="text-brand-400" />
                <span className="text-xs text-brand-300 font-mono truncate flex-1">{selectedFile}</span>
                <button onClick={() => setSelectedFile('')} className="text-slate-400 hover:text-white">
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="mt-2">
              <UsageMeter engine={engine} agent={agent} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <Cpu size={48} className="text-brand-500/20 mb-4" />
                <h3 className="text-xl font-bold mb-2">Agent Ready</h3>
                <p className="text-sm text-slate-400 max-w-[250px]">
                  Connected to {activeProject}. Pick an engine/agent, then send a prompt.
                </p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={idx} className={`flex flex-col max-w-[95%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                <div className={`p-3 rounded-2xl ${msg.role === 'user'
                  ? 'bg-brand-600 text-white rounded-br-sm'
                  : msg.type === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-400 rounded-bl-sm'
                  : msg.type === 'terminal' ? 'bg-dark-950 font-mono text-xs text-green-400 p-2 overflow-x-auto w-full'
                  : msg.type === 'diff' ? 'bg-dark-900 border border-dark-600 w-full overflow-hidden rounded-xl'
                  : msg.type === 'thinking' ? 'bg-dark-800 text-slate-400 text-sm flex items-center gap-2 italic rounded-bl-sm'
                  : 'bg-dark-800 text-slate-200 rounded-bl-sm border border-dark-700'
                }`}>
                  {msg.type === 'thinking' && <Loader2 size={14} className="animate-spin" />}
                  {msg.type === 'diff' ? (
                    <div>
                      <div className="bg-dark-800 px-3 py-1.5 text-xs font-mono text-slate-400 border-b border-dark-700">{msg.file}</div>
                      <pre className="p-3 text-xs overflow-x-auto font-mono">
                        <code>
                          {(msg.diff || '').split('\\n').map((line, i) => (
                            <div key={i} className={line.startsWith('+') ? 'text-green-400' : line.startsWith('-') ? 'text-red-400' : 'text-slate-400'}>
                              {line}
                            </div>
                          ))}
                        </code>
                      </pre>
                    </div>
                  ) : msg.type === 'text' ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {wsError && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              {wsError}
            </div>
          )}

          <div className="shrink-0 p-4 bg-gradient-to-t from-dark-900 via-dark-900 to-transparent">
            <div className="relative flex items-end bg-dark-800 border border-dark-600 rounded-2xl p-1 shadow-2xl focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/50 transition-all">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${engine === 'opencode' ? 'OpenCode' : 'AntiGravity agent'}...`}
                className="w-full bg-transparent border-none outline-none resize-none px-3 py-3 max-h-32 text-sm text-slate-200 placeholder-slate-500 min-h-[44px]"
                rows={1}
                disabled={isProcessing}
              />
              <button
                onClick={() => sendPrompt(input)}
                disabled={!input.trim() || isProcessing}
                className={`p-2 rounded-xl mb-1 mr-1 shrink-0 transition-colors ${input.trim() && !isProcessing ? 'bg-brand-500 text-dark-900 hover:bg-brand-400' : 'bg-dark-700 text-dark-500'}`}
              >
                {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PromptConsole;
