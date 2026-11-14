import { spawn } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import { PackageManagerType } from '../core/project-manifest';
import { redactSecrets } from '../utils/redactor';
import { terminateProcessTree } from '../utils/process-tree';

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
  failureReason?: string;
}

function selectProbePort(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.once('error', reject);
    reservation.listen(port, '127.0.0.1', () => {
      const address = reservation.address() as net.AddressInfo;
      reservation.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function runControlledStartupCheck(
  options: StartupCheckOptions,
): Promise<StartupCheckReport> {
  if (!options.allowExec) {
    return {
      executed: false,
      skippedReason: 'Startup health check skipped (requires explicit --allow-exec permission).',
      success: true,
      logs: '',
    };
  }

  let port: number;
  try {
    port = await selectProbePort(options.port);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { executed: true, success: false, logs: '', failureReason: redactSecrets(message) };
  }
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

    // npm/yarn/pnpm expose .cmd shims on Windows; those must be launched
    // through cmd.exe. The command is allowlisted above and arguments are fixed.
    const useWindowsCommandShell =
      process.platform === 'win32' && /^(?:npm|yarn|pnpm)\.cmd$/i.test(execBin);

    const child = spawn(execBin, ['run', 'start'], {
      cwd: options.rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
      },
      shell: useWindowsCommandShell,
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

    let request: http.ClientRequest | undefined;
    const finish = async (report: Omit<StartupCheckReport, 'executed' | 'logs'>) => {
      if (settled) return;
      settled = true;
      clearInterval(probeInterval);
      clearTimeout(timer);
      request?.destroy();
      await terminateProcessTree(child);
      resolve({ executed: true, ...report, logs: redactSecrets(logs) });
    };

    const timer = setTimeout(() => {
      void finish({
        success: false,
        failureReason: `Timed out after ${timeoutMs}ms waiting for HTTP on port ${port}.`,
      });
    }, timeoutMs);

    const probeInterval = setInterval(() => {
      if (request) return;
      const probe = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        const success = status >= 200 && status < 400;
        void finish({
          success,
          httpStatus: res.statusCode,
          failureReason: success ? undefined : `GET / returned HTTP ${status}.`,
        });
      });
      request = probe;
      probe.setTimeout(500, () => probe.destroy());
      probe.on('error', () => {
        request = undefined;
      });
    }, 250);

    child.on('error', (error) => {
      void finish({ success: false, failureReason: redactSecrets(error.message) });
    });

    child.on('exit', (code) => {
      void finish({
        success: false,
        failureReason: `The start script exited (${code ?? 'signal'}) before the HTTP probe succeeded.`,
      });
    });
  });
}
