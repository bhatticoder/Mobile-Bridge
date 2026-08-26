import React, { useState, useEffect, useRef } from 'react';
import { Send, Cpu, Bug, Lightbulb, PenTool, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

function PromptConsole({ pin, activeProject }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  const connectWs = () => {
    if (wsRef.current) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/prompt?project=${activeProject}&pin=${pin}`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'error') {
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
          // Remove the thinking message if it exists
          const filtered = prev.filter(m => m.type !== 'thinking');
          return [...filtered, { role: 'agent', content: data.response, type: 'text' }];
        });
        setIsProcessing(false);
      }
    };
    
    ws.onclose = () => {
      wsRef.current = null;
    };
    
    wsRef.current = ws;
  };

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [activeProject, pin]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendPrompt = (text) => {
    if (!text.trim() || isProcessing) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs();
      // small delay to connect
      setTimeout(() => sendPrompt(text), 500);
      return;
    }
    
    setMessages(prev => [...prev, { role: 'user', content: text, type: 'text' }]);
    wsRef.current.send(JSON.stringify({ type: 'prompt', content: text }));
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
      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-32">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Cpu size={48} className="text-brand-500/20 mb-4" />
            <h3 className="text-xl font-bold mb-2">Agent Ready</h3>
            <p className="text-sm text-slate-400 max-w-[250px]">
              Connected to {activeProject}. Send a prompt to execute tasks in this workspace.
            </p>
            
            <div className="grid grid-cols-2 gap-2 mt-8 w-full max-w-sm">
              <QuickAction icon={<Bug size={16}/>} label="Fix bugs" onClick={() => sendPrompt("Please analyze the workspace for any recent bugs and fix them.")} />
              <QuickAction icon={<Lightbulb size={16}/>} label="Explain code" onClick={() => sendPrompt("Explain the architecture of this project.")} />
              <QuickAction icon={<PenTool size={16}/>} label="Refactor" onClick={() => sendPrompt("Suggest refactoring improvements for this project.")} />
            </div>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col max-w-[90%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
            <div className={`p-3 rounded-2xl ${
              msg.role === 'user' 
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
                      {msg.diff.split('\\n').map((line, i) => (
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
      
      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-dark-900 via-dark-900 to-transparent pt-10">
        <div className="relative flex items-end bg-dark-800 border border-dark-600 rounded-2xl p-1 shadow-2xl focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/50 transition-all">
          <textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Agent..."
            className="w-full bg-transparent border-none outline-none resize-none px-3 py-3 max-h-32 text-sm text-slate-200 placeholder-slate-500 min-h-[44px]"
            rows={1}
            disabled={isProcessing}
          />
          <button 
            onClick={() => sendPrompt(input)}
            disabled={!input.trim() || isProcessing}
            className={`p-2 rounded-xl mb-1 mr-1 shrink-0 transition-colors ${
              input.trim() && !isProcessing 
                ? 'bg-brand-500 text-dark-900 hover:bg-brand-400' 
                : 'bg-dark-700 text-dark-500'
            }`}
          >
            {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center p-3 bg-dark-800 border border-dark-700 rounded-xl hover:border-brand-500/50 hover:bg-dark-700 transition-all text-slate-300 group">
      <div className="mb-2 text-slate-400 group-hover:text-brand-400 transition-colors">{icon}</div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

export default PromptConsole;
