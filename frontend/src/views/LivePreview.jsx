import React, { useState } from 'react';
import { ExternalLink, RefreshCw, Smartphone, Monitor } from 'lucide-react';

function LivePreview({ activeProject }) {
  const [port, setPort] = useState('5173');
  const [isMobileView, setIsMobileView] = useState(true);
  const [key, setKey] = useState(0); // Used to force refresh iframe

  const previewUrl = `http://${window.location.hostname}:${port}`;

  return (
    <div className="h-full flex flex-col bg-dark-900">
      {/* Browser Bar */}
      <div className="h-14 bg-dark-800 border-b border-dark-700 flex items-center px-4 gap-2 shrink-0">
        <button onClick={() => setKey(k => k + 1)} className="p-2 text-slate-400 hover:text-white transition-colors">
          <RefreshCw size={18} />
        </button>
        
        <div className="flex-1 bg-dark-900 border border-dark-700 rounded-lg flex items-center px-3 h-9">
          <span className="text-slate-500 text-sm mr-1">localhost:</span>
          <input 
            value={port}
            onChange={e => setPort(e.target.value)}
            className="bg-transparent border-none outline-none text-sm w-16 text-slate-200"
            placeholder="Port"
          />
        </div>
        
        <div className="flex bg-dark-900 rounded-lg border border-dark-700 p-0.5">
          <button 
            onClick={() => setIsMobileView(true)} 
            className={`p-1.5 rounded-md ${isMobileView ? 'bg-dark-700 text-brand-400' : 'text-slate-400 hover:text-white'}`}
          >
            <Smartphone size={16} />
          </button>
          <button 
            onClick={() => setIsMobileView(false)} 
            className={`p-1.5 rounded-md ${!isMobileView ? 'bg-dark-700 text-brand-400' : 'text-slate-400 hover:text-white'}`}
          >
            <Monitor size={16} />
          </button>
        </div>
        
        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="p-2 text-slate-400 hover:text-brand-400 transition-colors">
          <ExternalLink size={18} />
        </a>
      </div>
      
      {/* Iframe Container */}
      <div className="flex-1 bg-dark-950 flex items-center justify-center p-4 overflow-hidden">
        <div className={`transition-all duration-300 ease-in-out bg-white rounded-xl overflow-hidden shadow-2xl border border-dark-700 relative ${
          isMobileView ? 'w-[375px] h-[667px]' : 'w-full h-full'
        }`}>
          {/* Mock iPhone Notch in mobile view */}
          {isMobileView && (
            <div className="absolute top-0 inset-x-0 h-6 bg-transparent flex justify-center z-10 pointer-events-none">
              <div className="w-32 h-6 bg-black rounded-b-xl"></div>
            </div>
          )}
          
          <iframe 
            key={key}
            src={previewUrl}
            className="w-full h-full border-none bg-white"
            title="Live Preview"
            sandbox="allow-same-origin allow-scripts allow-forms"
          />
        </div>
      </div>
    </div>
  );
}

export default LivePreview;
