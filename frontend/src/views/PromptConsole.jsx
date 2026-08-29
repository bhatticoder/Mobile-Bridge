import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, FolderOpen, X, Cpu, Paperclip, FileText, File as FileIcon, XCircle, Plus, Trash2, SquarePen, Bot, Boxes, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { EngineSelector, FileExplorer, UsageMeter } from '../components/EnginePanel';

function PromptConsole({ token, activeProject, chat, setChat }) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [wsError, setWsError] = useState('');
  const [showExplorer, setShowExplorer] = useState(false);
  const [showSidebar, setShowSidebar] = useState(window.innerWidth >= 768);
  const [engineCfgOpen, setEngineCfgOpen] = useState(window.innerWidth >= 768);
  const [conversations, setConversations] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempts = useRef(0);
  const isIntentionalClose = useRef(false);
  const appHot = useRef(null);
  const currentParams = useRef({ sid: '', e: 'antigravity', a: 'code-fixer', m: '' });

  const sessionId = chat.sessionId || '';
  const engine = chat.engine || 'antigravity';
  const agent = chat.agent || 'code-fixer';
  const model = chat.model || '';
  const messages = chat.messages || [];
  const selectedFile = chat.selectedFile || '';

  const refreshConversations = useCallback(() => {
    fetch(`/api/sessions/conversations?project=${encodeURIComponent(activeProject)}&limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(setConversations)
      .catch(() => {});
  }, [activeProject, token]);

  const appendMsg = useCallback((msg) => {
    setChat(prev => ({ ...prev, project: activeProject, messages: [...(prev.messages || []), msg] }));
  }, [activeProject, setChat]);

  const buildWsUrl = (sid, e, a, m) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/prompt?project=${encodeURIComponent(activeProject)}` +
      `&token=${encodeURIComponent(token)}` +
      (sid ? `&session_id=${encodeURIComponent(sid)}` : '') +
      `&engine=${encodeURIComponent(e)}&agent=${encodeURIComponent(a)}&model=${encodeURIComponent(m)}`;
  };

  const connectWsRef = useRef(() => {});

  const connectWs = useCallback((sid, e, a, m) => {
    if (wsRef.current) {
      isIntentionalClose.current = true;
      try { wsRef.current.close(); } catch {}
    }
    currentParams.current = { sid, e, a, m };
    setWsError('');
    setChat({ project: activeProject, sessionId: sid || '', messages: [], engine: e, agent: a, model: m, selectedFile: '' });

    const wsUrl = buildWsUrl(sid, e, a, m);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => { setWsError(''); reconnectAttempts.current = 0; };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') return;

      if (data.type === 'history') {
        const msgs = (data.messages || []).map(m => ({
          role: m.role, content: m.content, type: m.type,
          file: m.file_path, diff: m.diff,
          extra: m.extra ? (typeof m.extra === 'string' ? safeParse(m.extra) : m.extra) : null,
        }));
        setChat({ project: activeProject, sessionId: data.session_id, messages: msgs, engine: e, agent: a, model: m, selectedFile: '' });
        setIsProcessing(false);
        refreshConversations();
      } else if (data.type === 'session') {
        setChat(prev => ({ ...prev, sessionId: data.session_id }));
        refreshConversations();
      } else if (data.type === 'running') {
        setIsProcessing(true);
      } else if (data.type === 'run_status') {
        setIsProcessing(false);
      } else if (data.type === 'error') {
        appendMsg({ role: 'system', content: `Error: ${data.content}`, type: 'error' });
        setIsProcessing(false);
      } else if (data.type === 'thinking') {
        setChat(prev => {
          const msgs = prev.messages || [];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'agent' && last.type === 'thinking') {
            return { ...prev, messages: [...msgs.slice(0, -1), { ...last, content: data.content }] };
          }
          return { ...prev, messages: [...msgs, { role: 'agent', content: data.content, type: 'thinking' }] };
        });
      } else if (data.type === 'stdout' || data.type === 'stderr') {
        appendMsg({ role: 'agent', content: data.content, type: 'terminal' });
      } else if (data.type === 'file_mod') {
        appendMsg({ role: 'agent', file: data.file, diff: data.diff, type: 'diff' });
      } else if (data.type === 'attachment_ok') {
        appendMsg({
          role: 'user', type: 'attachment', content: `📎 ${data.name}`,
          extra: { name: data.name, url: data.url, is_image: data.is_image },
        });
      } else if (data.type === 'done') {
        setChat(prev => {
          const filtered = (prev.messages || []).filter(m => m.type !== 'thinking');
          return { ...prev, messages: [...filtered, { role: 'agent', content: data.response, type: 'text', elapsed: data.elapsed }] };
        });
        setIsProcessing(false);
        refreshConversations();
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!isIntentionalClose.current) {
        reconnectTimer.current = setTimeout(() => {
          if (!appHot.current) return;
          reconnectAttempts.current += 1;
          connectWsRef.current(currentParams.current.sid, currentParams.current.e, currentParams.current.a, currentParams.current.m);
        }, Math.min(1000 * Math.pow(1.5, reconnectAttempts.current), 8000));
      } else {
        isIntentionalClose.current = false;
      }
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };

    wsRef.current = ws;
  }, [activeProject, appendMsg, refreshConversations, setChat]);
  connectWsRef.current = connectWs;

  // Keep the reconnect params in sync with the live engine/agent/model choice,
  // so switching agents mid-chat is honoured by the next prompt + reconnect.
  useEffect(() => {
    currentParams.current = {
      sid: currentParams.current.sid,
      e: engine,
      a: agent,
      m: model,
    };
  }, [engine, agent, model]);

  const startNewWs = useCallback((sid, e, a, m) => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectAttempts.current = 0;
    isIntentionalClose.current = true;
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    wsRef.current = null;
    connectWs(sid, e, a, m);
  }, [connectWs]);

  useEffect(() => {
    appHot.current = true;
    // Resume the persisted session for this project, else start a fresh chat.
    if (chat.project === activeProject && chat.sessionId) {
      connectWs(chat.sessionId, chat.engine || 'antigravity', chat.agent || 'code-fixer', chat.model || '');
    } else if (chat.project === activeProject && chat.messages?.length > 0) {
      startNewWs('', chat.engine || 'antigravity', chat.agent || 'code-fixer', chat.model || '');
    } else {
      connectWs('', 'antigravity', 'code-fixer', '');
    }
    return () => {
      appHot.current = false;
      isIntentionalClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
      wsRef.current = null;
    };
  }, [activeProject, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (showSidebar) refreshConversations();
  }, [showSidebar, activeProject]);

  // Poll for running-state changes while processing (server may finish elsewhere).
  useEffect(() => {
    if (!isProcessing) return;
    const t = setInterval(refreshConversations, 5000);
    return () => clearInterval(t);
  }, [isProcessing]);

  const newChat = () => {
    isIntentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    wsRef.current = null;
    setChat({ project: activeProject, sessionId: '', messages: [], engine, agent, model, selectedFile: '' });
    setAttachments([]);
    setIsProcessing(false);
    refreshConversations();
    connectWs('', engine, agent, model);
  };

  const resumeChat = (c) => {
    isIntentionalClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    wsRef.current = null;
    setChat({ project: activeProject, sessionId: c.id, messages: [], engine: c.engine || 'antigravity', agent: c.agent || 'code-fixer', model: c.model || '', selectedFile: '' });
    setAttachments([]);
    setIsProcessing(c.running);
    connectWs(c.id, c.engine || 'antigravity', c.agent || 'code-fixer', c.model || '');
  };

  const deleteChat = (e, c) => {
    e.stopPropagation();
    fetch(`/api/sessions/${c.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async () => {
        refreshConversations();
        if (c.id === sessionId) {
          newChat();
        }
      })
      .catch(() => {});
  };

  const pickFiles = () => fileInputRef.current?.click();

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    let i = 0;
    const readNext = () => {
      if (i >= files.length) { e.target.value = ''; return; }
      const f = files[i];
      const fr = new FileReader();
      fr.onload = () => {
        const dataUrl = fr.result;
        const base64 = String(dataUrl).split(',')[1] || '';
        const mime = f.type || 'application/octet-stream';
        const isImage = mime.startsWith('image/');
        const attachment = { name: f.name, mime, is_image: isImage };
        setAttachments(prev => [...prev, attachment]);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'attachment', name: f.name, mime, data: base64 }));
        }
        i++;
        readNext();
      };
      fr.readAsDataURL(f);
    };
    readNext();
  };

  const sendPrompt = (text) => {
    const final = (text || '').trim();
    if ((!final && attachments.length === 0) || isProcessing) return;
    const attachmentNote = selectedFile ? `\n\n[Attached file: ${selectedFile}]` : '';

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs(sessionId, engine, agent, model);
      setTimeout(() => { if (!isProcessing) sendPrompt(text); }, 800);
      return;
    }

    appendMsg({ role: 'user', content: final + attachmentNote, type: 'text' });
    wsRef.current.send(JSON.stringify({ type: 'prompt', content: final + attachmentNote, engine, agent, model }));
    setInput('');
    setAttachments([]);
    setIsProcessing(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt(input);
    }
  };

  const renderMessage = (msg, idx) => {
    const isImage = msg.extra?.is_image;
    return (
      <div key={idx} className={`flex flex-col max-w-[95%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
        <div className={`p-3 rounded-2xl ${
          msg.role === 'user'
            ? msg.type === 'attachment'
              ? 'bg-brand-500/10 border border-brand-500/40 text-white rounded-br-sm flex items-center gap-2'
              : 'bg-brand-600 text-white rounded-br-sm'
            : msg.type === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-400 rounded-bl-sm'
            : msg.type === 'terminal' ? 'bg-dark-950 font-mono text-xs text-green-400 p-2 overflow-x-auto w-full'
            : msg.type === 'diff' ? 'bg-dark-900 border border-dark-600 w-full overflow-hidden rounded-xl'
            : msg.type === 'thinking' ? 'bg-dark-800 text-slate-400 text-sm flex items-center gap-2 italic rounded-bl-sm'
            : 'bg-dark-800 text-slate-200 rounded-bl-sm border border-dark-700'
        }`}>
          {msg.type === 'thinking' && <Loader2 size={14} className="animate-spin shrink-0" />}
          {msg.type === 'attachment' && isImage && msg.extra?.url && (
            <div className="flex flex-col gap-2 w-64">
              <span className="text-xs flex items-center gap-1.5"><FileIcon size={13} /> {msg.content}</span>
              <img src={msg.extra.url} alt={msg.extra.name} className="rounded-lg max-w-full border border-dark-600" />
            </div>
          )}
          {msg.type === 'attachment' && !isImage && (
            <span className="text-xs flex items-center gap-1.5"><FileText size={13} /> {msg.content}</span>
          )}
          {msg.type !== 'attachment' && (
            msg.type === 'diff' ? (
              <div>
                <div className="bg-dark-800 px-3 py-1.5 text-xs font-mono text-slate-400 border-b border-dark-700">{msg.file}</div>
                <pre className="p-3 text-xs overflow-x-auto font-mono">
                  <code>
                    {(msg.diff || '').split('\\n').map((line, li) => (
                      <div key={li} className={line.startsWith('+') ? 'text-green-400' : line.startsWith('-') ? 'text-red-400' : 'text-slate-400'}>
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
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col relative">
      {/* Top toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-dark-800 bg-dark-900/80 overflow-x-auto">
        <button onClick={() => setShowSidebar(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-dark-800 text-slate-300 hover:text-white border border-dark-700">
          <Plus size={13} className={showSidebar ? 'rotate-45 transition-transform' : 'transition-transform'} />
          {showSidebar ? 'Hide history' : 'Chat history'}
        </button>
        <button onClick={() => { setShowExplorer(v => !v); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${showExplorer ? 'bg-brand-500/15 text-brand-400 border border-brand-500' : 'bg-dark-800 text-slate-300 hover:text-white border border-dark-700'}`}>
          <FolderOpen size={13} /> Explorer
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {engine === 'opencode' && <Bot size={13} className="text-brand-400" />}
          {engine === 'antigravity' && <Boxes size={13} className="text-brand-400" />}
          {isProcessing && <Loader2 size={13} className="animate-spin text-amber-400" />}
          <span className="text-[10px] font-mono text-slate-500 truncate max-w-[160px]">
            {sessionId ? sessionId : 'new chat'}
          </span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Mobile backdrop for the drawers */}
        {showSidebar && window.innerWidth < 768 && (
          <div className="absolute inset-0 z-20 bg-black/60 md:hidden" onClick={() => setShowSidebar(false)} />
        )}

        {/* Chat-history sidebar (Claude/Gemini style) — drawer on mobile */}
        {showSidebar && (
          <div className="absolute inset-y-0 left-0 z-30 flex w-80 max-w-[85vw] shrink-0 border-r border-dark-800 bg-dark-900 flex-col min-h-0 md:relative md:z-auto md:w-64 md:max-w-none">
            <div className="p-2 border-b border-dark-800">
              <button onClick={newChat}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-dark-900 text-sm font-semibold transition-colors">
                <SquarePen size={15} /> New Chat
              </button>
            </div>
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-dark-800 flex items-center justify-between">
              <span>Chats</span>
              <button onClick={refreshConversations} className="text-slate-500 hover:text-brand-400"><RotateCcw size={12} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 && (
                <p className="text-xs text-slate-500 p-3">No chats yet. Start a new chat to get going.</p>
              )}
              {conversations.map(c => (
                <div key={c.id}
                  onClick={() => resumeChat(c)}
                  className={`group cursor-pointer px-3 py-2.5 border-b border-dark-800/60 hover:bg-dark-800/60 transition-colors ${c.id === sessionId ? 'bg-brand-500/10' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {c.running ? (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    ) : (
                      <span className={`w-2 h-2 rounded-full shrink-0 ${c.engine === 'opencode' ? 'bg-brand-400' : 'bg-slate-600'}`} />
                    )}
                    <span className={`text-xs font-medium truncate flex-1 ${c.id === sessionId ? 'text-brand-300' : 'text-slate-300'}`}>
                      {c.title || c.last_message?.slice(0, 40) || 'Untitled chat'}
                    </span>
                    <button onClick={(e) => deleteChat(e, c)}
                      className="opacity-60 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity p-1 -m-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {c.last_message && (
                    <p className="text-[10px] text-slate-500 truncate ml-4">{c.last_message}</p>
                  )}
                  <div className="flex items-center gap-2 ml-4 mt-0.5">
                    <span className="text-[9px] text-slate-600">{timeAgo(c.updated_at)}</span>
                    <span className="text-[9px] uppercase tracking-wide text-slate-600">
                      {c.engine === 'opencode' ? 'OpenCode' : 'AntiGravity'} · {c.agent || c.model || ''}
                    </span>
                    {c.running && <span className="text-[9px] text-amber-400">running</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File explorer panel — drawer on mobile */}
        {showExplorer && (
          <div className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85vw] shrink-0 border-l border-dark-800 bg-dark-900 flex-col min-h-0 md:relative md:z-auto md:w-64 md:border-r md:border-l-0">
            <div className="md:hidden p-2 border-b border-dark-800 flex justify-end">
              <button onClick={() => setShowExplorer(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <FileExplorer token={token} project={activeProject}
              selectedFile={selectedFile}
              onSelectFile={(p) => setChat(prev => ({ ...prev, selectedFile: p }))} />
          </div>
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="shrink-0 px-3 pt-2 pb-1 overflow-y-auto max-h-[38%]">
            <div className="md:hidden">
              <button onClick={() => setEngineCfgOpen(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-left">
                <span className="flex items-center gap-2">
                  {engine === 'opencode' ? <Bot size={14} className="text-brand-400" /> : <Boxes size={14} className="text-brand-400" />}
                  <span className="text-xs font-medium">{engine === 'opencode' ? (model || 'OpenCode model') : (agent || 'AntiGravity agent')}</span>
                </span>
                {engineCfgOpen ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
              </button>
              {engineCfgOpen && (
                <div className="mt-2">
                  <EngineSelector token={token} engine={engine} onEngineChange={(e) => setChat(prev => ({ ...prev, engine: e }))}
                    agent={agent} onAgentChange={(a) => setChat(prev => ({ ...prev, agent: a }))}
                    model={model} onModelChange={(m) => setChat(prev => ({ ...prev, model: m }))} />
                </div>
              )}
            </div>
            <div className="hidden md:block">
              <EngineSelector token={token} engine={engine} onEngineChange={(e) => setChat(prev => ({ ...prev, engine: e }))}
                agent={agent} onAgentChange={(a) => setChat(prev => ({ ...prev, agent: a }))}
                model={model} onModelChange={(m) => setChat(prev => ({ ...prev, model: m }))} />
            </div>
            {selectedFile && (
              <div className="mt-2 flex items-center gap-2 bg-brand-500/10 border border-brand-500/30 rounded-lg px-3 py-1.5">
                <FolderOpen size={13} className="text-brand-400" />
                <span className="text-xs text-brand-300 font-mono truncate flex-1">{selectedFile}</span>
                <button onClick={() => setChat(prev => ({ ...prev, selectedFile: '' }))} className="text-slate-400 hover:text-white"><X size={13} /></button>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-dark-800 border border-dark-600 rounded-lg px-2 py-1">
                    {a.is_image ? <FileIcon size={12} className="text-brand-400" /> : <FileText size={12} className="text-slate-400" />}
                    <span className="text-[10px] text-slate-300 truncate max-w-[100px]">{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-400"><XCircle size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            {engine === 'antigravity' && <div className="mt-2"><UsageMeter engine={engine} agent={agent} /></div>}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <Cpu size={48} className="text-brand-500/20 mb-4" />
                <h3 className="text-xl font-bold mb-2">Start a new chat</h3>
                <p className="text-sm text-slate-400 max-w-[260px]">
                  Pick an engine/agent, attach files, then send a prompt. Your chat history is saved automatically.
                </p>
              </div>
            )}
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>

          {wsError && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">{wsError}</div>
          )}

          <div className="shrink-0 p-4 bg-gradient-to-t from-dark-900 via-dark-900 to-transparent">
            <div className="flex items-end gap-2">
              <button onClick={pickFiles} title="Attach file or image"
                className="p-2.5 bg-dark-800 border border-dark-600 rounded-2xl text-slate-400 hover:text-brand-400 hover:border-brand-500 transition-colors shrink-0">
                <Paperclip size={18} />
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} accept="image/*,.txt,.md,.json,.py,.js,.ts,.jsx,.tsx,.log,.yml,.yaml,.html,.css" />
              <div className="relative flex items-end bg-dark-800 border border-dark-600 rounded-2xl p-1 shadow-2xl focus-within:border-brand-500 transition-all flex-1">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${engine === 'opencode' ? 'OpenCode' : 'AntiGravity agent'}...`}
                  className="w-full bg-transparent border-none outline-none resize-none px-3 py-3 max-h-32 text-sm text-slate-200 placeholder-slate-500 min-h-[44px]"
                  rows={1}
                  disabled={isProcessing}
                />
                <button onClick={() => sendPrompt(input)}
                  disabled={(!input.trim() && attachments.length === 0) || isProcessing}
                  className={`p-2 rounded-xl mb-1 mr-1 shrink-0 transition-colors ${(input.trim() || attachments.length > 0) && !isProcessing ? 'bg-brand-500 text-dark-900 hover:bg-brand-400' : 'bg-dark-700 text-dark-500'}`}>
                  {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default PromptConsole;