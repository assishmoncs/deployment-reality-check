import { ChildProcess, spawn } from 'child_process';

/**
 * Stop a child and any descendants it launched.
 *
 * Windows does not expose POSIX process groups, so use taskkill's tree mode.
 * The PID is supplied by Node and passed as an argument (never through a shell).
 */
export function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return Promise.resolve();

  if (process.platform === 'win32') {
    return new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        try {
          child.kill();
        } catch {
          // The child may already have exited.
        }
        resolve();
      });
      killer.once('close', () => resolve());
    });
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The child may already have exited.
    }
  }

  const forceKill = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process tree has already exited.
      }
    }
  }, 500);
  forceKill.unref();
  return Promise.resolve();
}
