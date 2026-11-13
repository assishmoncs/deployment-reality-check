import { spawn } from 'child_process';
import * as http from 'http';
import { PackageManagerType } from '../core/project-manifest';
import { redactSecrets } from '../utils/redactor';

export interface StartupCheckOptions {
  rootDir: string;
  packageManager: PackageManagerType;
  allowExec: boolean;
  port?: number;
  timeoutMs?: number;
}

export interface StartupCheckReport {
  executed: boolean;
  skippedReason?: string;
  success: boolean;
  httpStatus?: number;
  logs: string;
}

export async function runControlledStartupCheck(
  options: StartupCheckOptions,
): Promise<StartupCheckReport> {
  if (!options.allowExec) {
    return {
      executed: false,
      skippedReason:
        'Startup health check skipped (requires explicit --allow-exec permission).',
      success: true,
      logs: '',
    };
  }

  const port = options.port ?? 45912;
  const timeoutMs = options.timeoutMs ?? 8000;
  const bin =
    options.packageManager === 'yarn'
      ? 'yarn'
      : options.packageManager === 'pnpm'
      ? 'pnpm'
      : options.packageManager === 'bun'
      ? 'bun'
      : 'npm';
  const execBin = process.platform === 'win32' && bin !== 'bun' ? `${bin}.cmd` : bin;
  const isPosix = process.platform !== 'win32';

  return new Promise<StartupCheckReport>((resolve) => {
    let logs = '';
    let settled = false;

    const child = spawn(execBin, ['run', 'start'], {
      cwd: options.rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
      },
      shell: false,
      detached: isPosix,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      child.stdout.on('data', (d: Buffer) => {
        if (logs.length < 16384) logs += d.toString('utf8');
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (d: Buffer) => {
        if (logs.length < 16384) logs += d.toString('utf8');
      });
    }

    const killProcessTree = () => {
      try {
        if (isPosix && child.pid) {
          process.kill(-child.pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // already exited
      }
      setTimeout(() => {
        try {
          if (isPosix && child.pid) {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // already exited
        }
      }, 200);
    };

    const cleanupAndResolve = (report: StartupCheckReport) => {
      if (settled) return;
      settled = true;
      killProcessTree();
      resolve({
        ...report,
        logs: redactSecrets(logs),
      });
    };

    const timer = setTimeout(() => {
      clearInterval(probeInterval);
      cleanupAndResolve({
        executed: true,
        success: false,
        logs,
        skippedReason: `Startup check timed out after ${timeoutMs}ms waiting for port ${port}`,
      });
    }, timeoutMs);

    const probeInterval = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        clearInterval(probeInterval);
        clearTimeout(timer);
        res.resume();
        cleanupAndResolve({
          executed: true,
          success: true,
          httpStatus: res.statusCode,
          logs,
        });
      });
      req.on('error', () => {
        // server not listening yet
      });
    }, 250);

    child.on('close', (code) => {
      clearInterval(probeInterval);
      clearTimeout(timer);
      if (!settled) {
        cleanupAndResolve({
          executed: true,
          success: code === 0,
          logs,
        });
      }
    });
  });
}
