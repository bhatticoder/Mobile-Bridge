import React, { useState, useEffect } from 'react';
import { FolderGit2, ChevronRight, RefreshCw, Plus, Github } from 'lucide-react';

function ProjectSelector({ pin, activeProject, onSelect, onNavigate }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRepo, setNewProjectRepo] = useState('');

  const fetchProjects = () => {
    setLoading(true);
    fetch('/api/projects', {
      headers: { 'Authorization': `Bearer ${pin}` }
    })
    .then(res => res.json())
    .then(data => {
      setProjects(data);
      setLoading(false);
    })
    .catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = (e) => {
    e.preventDefault();
    fetch('/api/projects/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pin}`
      },
      body: JSON.stringify({ name: newProjectName, repo_url: newProjectRepo })
    })
    .then(res => {
      if (res.ok) {
        setIsCreating(false);
        setNewProjectName('');
        setNewProjectRepo('');
        fetchProjects();
      }
    });
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">Workspaces</h2>
        <div className="flex gap-2">
          <button onClick={() => setIsCreating(!isCreating)} className="p-2 bg-dark-800 rounded-lg text-slate-300 hover:text-white">
            <Plus size={20} />
          </button>
          <button onClick={fetchProjects} className={`p-2 bg-dark-800 rounded-lg text-slate-300 hover:text-white ${loading ? 'animate-spin' : ''}`}>
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className="bg-dark-800 p-4 rounded-xl border border-brand-500/30 mb-6 shadow-lg shadow-brand-500/5">
          <h3 className="font-semibold mb-3">New Project</h3>
          <input 
            required
            className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 mb-3 focus:border-brand-500 outline-none text-sm"
            placeholder="Project Name (e.g. my-app)"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
          />
          <div className="relative">
            <Github className="absolute left-3 top-2.5 text-slate-500" size={16} />
            <input 
              className="w-full bg-dark-900 border border-dark-600 rounded-lg pl-9 pr-3 py-2 mb-4 focus:border-brand-500 outline-none text-sm"
              placeholder="Git URL (optional)"
              value={newProjectRepo}
              onChange={e => setNewProjectRepo(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 bg-brand-500 text-dark-900 font-semibold py-2 rounded-lg text-sm hover:bg-brand-400">Create</button>
            <button type="button" onClick={() => setIsCreating(false)} className="flex-1 bg-dark-700 text-white font-semibold py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3 pb-8">
        {projects.length === 0 && !loading && (
          <div className="text-center text-slate-500 py-10">
            No projects found. Create one!
          </div>
        )}
        
        {projects.map(p => (
          <div 
            key={p.name}
            onClick={() => {
              onSelect(p.name);
              onNavigate();
            }}
            className={`p-4 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${
              activeProject === p.name 
                ? 'bg-brand-500/10 border-brand-500 text-white shadow-[0_0_15px_rgba(20,184,166,0.15)]' 
                : 'bg-dark-800 border-dark-700 hover:border-dark-500'
            }`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${activeProject === p.name ? 'bg-brand-500 text-dark-900' : 'bg-dark-700 text-slate-400'}`}>
                <FolderGit2 size={20} />
              </div>
              <div className="overflow-hidden">
                <h3 className="font-medium truncate">{p.name}</h3>
                <div className="flex gap-2 text-xs mt-1 text-slate-500">
                  {p.git_branch && <span className="bg-dark-900 px-1.5 py-0.5 rounded">{p.git_branch}</span>}
                  {p.git_status && <span className={p.git_status === 'Dirty' ? 'text-amber-500' : 'text-brand-500'}>{p.git_status}</span>}
                </div>
              </div>
            </div>
            <ChevronRight className="text-slate-600 shrink-0" size={20} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProjectSelector;
