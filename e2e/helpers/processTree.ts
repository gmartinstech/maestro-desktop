import { execFileSync } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';

type ProcessInfo = { pid: number; parentPid: number };

export function descendantPids(rootPid: number, processes: ProcessInfo[]): number[] {
  const found = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (found.has(process.parentPid) && !found.has(process.pid)) {
        found.add(process.pid);
        changed = true;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

function runningProcesses(): ProcessInfo[] {
  try {
    if (process.platform === 'win32') {
      const raw = execFileSync('pwsh', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'], { encoding: 'utf8' });
      const rows = JSON.parse(raw || '[]');
      return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ pid: row.ProcessId, parentPid: row.ParentProcessId }));
    }
    const raw = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    return raw.split('\n').flatMap((line) => {
      const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
      return Number.isFinite(pid) && Number.isFinite(parentPid) ? [{ pid, parentPid }] : [];
    });
  } catch {
    return [];
  }
}

/** Close Electron and then reap bundled services that outlive its process. */
export async function closePackagedApp(app: ElectronApplication): Promise<void> {
  const rootPid = app.process()?.pid;
  const descendants = rootPid ? descendantPids(rootPid, runningProcesses()).filter((pid) => pid !== rootPid) : [];
  await app.close().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const pid of descendants) {
    try { process.kill(pid); } catch { /* process already exited */ }
  }
}
