import asyncio
import json
import uuid

class AgentRunner:
    def __init__(self, project_path: str):
        self.project_path = project_path
        
    async def run_prompt(self, prompt: str, websocket):
        """
        Mocks running an agent and streams back results over the websocket.
        Expected message formats:
        { "type": "stdout", "content": "..." }
        { "type": "stderr", "content": "..." }
        { "type": "thinking", "content": "..." }
        { "type": "file_mod", "file": "...", "diff": "..." }
        { "type": "done", "response": "..." }
        """
        
        # Simulated thinking
        await websocket.send_json({"type": "thinking", "content": f"Analyzing prompt: '{prompt}' for project at {self.project_path}..."})
        await asyncio.sleep(1.5)
        
        # Simulated file change
        await websocket.send_json({"type": "thinking", "content": "Planning modifications..."})
        await asyncio.sleep(1)
        
        diff_str = "--- a/src/App.jsx\n+++ b/src/App.jsx\n@@ -1,5 +1,6 @@\n import React from 'react';\n+import { NewFeature } from './components';\n \n function App() {\n-  return <div>Hello</div>;\n+  return <div><NewFeature /></div>;\n }"
        
        await websocket.send_json({"type": "file_mod", "file": "src/App.jsx", "diff": diff_str})
        await asyncio.sleep(1)
        
        # Simulated stdout
        await websocket.send_json({"type": "stdout", "content": "Build successful.\n"})
        await asyncio.sleep(0.5)
        
        # Done
        await websocket.send_json({
            "type": "done", 
            "response": f"I have processed your request for '{prompt}'. The changes have been applied."
        })
