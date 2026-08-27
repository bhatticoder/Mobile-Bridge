import React, { useState, useEffect } from 'react';
import { FolderGit2, TerminalSquare, MonitorPlay, MessageSquare, Link2 } from 'lucide-react';
import ProjectSelector from './views/ProjectSelector';
import PromptConsole from './views/PromptConsole';
import TerminalView from './views/TerminalView';
import LivePreview from './views/LivePreview';
import ConnectionView from './views/ConnectionView';

const TOKEN_KEY = 'antigravity_token';

function App() {
  const [activeTab, setActiveTab] = useState('projects');
  const [activeProject, setActiveProject] = useState(null);
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [pin, setPin] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setIsAuthenticated(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    fetch('/api/projects', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (res.ok) {
          setIsAuthenticated(true);
          localStorage.setItem(TOKEN_KEY, token);
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => setIsAuthenticated(false))
      .finally(() => setChecking(false));
  }, [token]);

  const handleLogin = (e) => {
    e.preventDefault();
    setLoginError('');
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    })
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          setToken(data.token);
        } else {
          setLoginError('Wrong PIN. Try again.');
        }
      })
      .catch(() => setLoginError('Could not reach the hub.'));
  };

  const handleLogout = () => {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setActiveProject(null);
    setActiveTab('projects');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-dark-800 p-6 rounded-2xl shadow-xl w-full max-w-sm border border-dark-700">
          <div className="w-12 h-12 bg-brand-500 rounded-xl mb-6 mx-auto flex items-center justify-center">
            <FolderGit2 className="text-white" size={24} />
          </div>
          <h1 className="text-xl font-bold text-center mb-2">Antigravity Hub</h1>
          <p className="text-sm text-slate-400 text-center mb-6">
            {checking ? 'Checking session...' : 'Enter PIN to access your workspaces'}
          </p>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-4 py-3 text-center tracking-widest text-lg mb-4 focus:outline-none focus:border-brand-500 transition-colors"
              placeholder="••••"
              value={pin}
              onChange={e => setPin(e.target.value)}
              disabled={checking}
            />
            {loginError && <p className="text-red-400 text-sm text-center mb-2">{loginError}</p>}
            <button
              type="submit"
              disabled={!pin.trim() || checking}
              className="w-full py-3 bg-brand-500 hover:bg-brand-400 text-dark-900 font-semibold rounded-lg disabled:opacity-40 transition-colors"
            >
              {checking ? 'Checking...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'projects':
        return <ProjectSelector token={token} activeProject={activeProject} onSelect={setActiveProject} onNavigate={() => setActiveTab('console')} />;
      case 'console':
        return <PromptConsole token={token} activeProject={activeProject} />;
      case 'terminal':
        return <TerminalView token={token} activeProject={activeProject} />;
      case 'preview':
        return <LivePreview token={token} activeProject={activeProject} />;
      case 'connect':
        return <ConnectionView token={token} onLogout={handleLogout} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-dark-900 overflow-hidden">
      <header className="h-14 shrink-0 bg-dark-800 border-b border-dark-700 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <FolderGit2 className="text-white" size={16} />
          </div>
          <span className="font-semibold text-sm">AntiGrav Hub</span>
        </div>
        {activeProject && (
          <div className="text-xs px-2 py-1 bg-brand-500/20 text-brand-400 rounded-md truncate max-w-[150px]">
            {activeProject}
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden relative">
        {renderContent()}
      </main>

      <nav className="h-16 shrink-0 bg-dark-800 border-t border-dark-700 flex items-center justify-around px-2 pb-safe">
        <NavItem icon={<FolderGit2 size={20} />} label="Projects" isActive={activeTab === 'projects'} onClick={() => setActiveTab('projects')} />
        <NavItem icon={<MessageSquare size={20} />} label="Console" isActive={activeTab === 'console'} onClick={() => setActiveTab('console')} disabled={!activeProject} />
        <NavItem icon={<TerminalSquare size={20} />} label="Terminal" isActive={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} disabled={!activeProject} />
        <NavItem icon={<MonitorPlay size={20} />} label="Preview" isActive={activeTab === 'preview'} onClick={() => setActiveTab('preview')} disabled={!activeProject} />
        <NavItem icon={<Link2 size={20} />} label="Connect" isActive={activeTab === 'connect'} onClick={() => setActiveTab('connect')} />
      </nav>
    </div>
  );
}

function NavItem({ icon, label, isActive, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center w-16 h-12 gap-1 transition-colors ${
        disabled ? 'opacity-40 cursor-not-allowed' :
        isActive ? 'text-brand-500' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

export default App;