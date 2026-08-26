import os
import subprocess
import psutil
import threading
import queue
from typing import Dict, Any, Optional

class ProcessManager:
    def __init__(self):
        # project_name -> dict with process info
        self.processes: Dict[str, Dict[str, Any]] = {}
        
    def start_process(self, project_name: str, cwd: str, command: str) -> bool:
        if project_name in self.processes and self.processes[project_name]["process"].poll() is None:
            return False # Already running
            
        # Basic cross platform shell detection
        is_windows = os.name == 'nt'
        
        try:
            # We use shell=True to easily handle things like 'npm run dev'
            process = subprocess.Popen(
                command,
                cwd=cwd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            log_queue = queue.Queue(maxsize=1000)
            
            def enqueue_output(out, queue):
                for line in iter(out.readline, b''):
                    queue.put(line)
                out.close()
                
            t_out = threading.Thread(target=enqueue_output, args=(process.stdout, log_queue))
            t_err = threading.Thread(target=enqueue_output, args=(process.stderr, log_queue))
            t_out.daemon = True
            t_err.daemon = True
            t_out.start()
            t_err.start()
            
            self.processes[project_name] = {
                "process": process,
                "command": command,
                "logs": log_queue,
                "threads": (t_out, t_err)
            }
            return True
        except Exception as e:
            print(f"Error starting process: {e}")
            return False

    def stop_process(self, project_name: str) -> bool:
        if project_name not in self.processes:
            return False
            
        process_info = self.processes[project_name]
        p = process_info["process"]
        
        if p.poll() is None: # still running
            try:
                parent = psutil.Process(p.pid)
                for child in parent.children(recursive=True):
                    child.terminate()
                parent.terminate()
                
                # Wait for termination
                p.wait(timeout=3)
            except (psutil.NoSuchProcess, subprocess.TimeoutExpired):
                try:
                    # Force kill if still alive
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/F', '/T', '/PID', str(p.pid)])
                    else:
                        p.kill()
                except Exception:
                    pass
                    
        del self.processes[project_name]
        return True
        
    def get_status(self, project_name: str) -> dict:
        if project_name not in self.processes:
            return {"status": "stopped"}
            
        p = self.processes[project_name]["process"]
        if p.poll() is None:
            return {"status": "running", "pid": p.pid, "command": self.processes[project_name]["command"]}
        else:
            return {"status": "exited", "code": p.poll()}
            
    def get_recent_logs(self, project_name: str, count: int = 50) -> list:
        if project_name not in self.processes:
            return []
            
        q = self.processes[project_name]["logs"]
        logs = []
        try:
            while len(logs) < count:
                logs.append(q.get_nowait())
        except queue.Empty:
            pass
            
        return logs

process_manager = ProcessManager()
