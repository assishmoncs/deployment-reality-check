import { spawn } from 'child_process';
import { redactSecrets } from '../utils/redactor';
import { resolveProcessCommand } from '../utils/process-command';
import { terminateProcessTree } from '../utils/process-tree';

export interface BoundedProcessOptions {
  cwd: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  maxLogBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BoundedProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Executes an external command without shell string interpolation (shell: false),
 * enforcing strict timeout, bounded output buffer capture, secret redaction, and process cleanup.
 *
 * SECURITY NOTE: Spawning a subprocess is NOT a security sandbox. Never invoke
 * project-defined scripts without explicit user authorization.
 */
export async function runBoundedProcess(
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxLogBytes = options.maxLogBytes ?? 64 * 1024;
  const startTime = Date.now();

  return new Promise<BoundedProcessResult>((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;
    let settled = false;

    const invocation = resolveProcessCommand(options.command, options.args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        CI: 'true',
      },
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const appendBounded = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current, 'utf8') >= maxLogBytes) {
        return current;
      }
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > maxLogBytes) {
        return `${next.slice(0, maxLogBytes)}\n...[output truncated at ${maxLogBytes} bytes]`;
      }
      return next;
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf = appendBounded(stdoutBuf, chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf = appendBounded(stderrBuf, chunk);
      });
    }

    let termination: Promise<void> | undefined;
    let cleanupTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      termination = terminateProcessTree(child);
      // A descendant can keep the pipes open after the original process exits.
      cleanupTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(null);
      }, 3000);
    }, timeoutMs);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      resolve({
        exitCode: code,
        timedOut,
        stdout: redactSecrets(stdoutBuf),
        stderr: redactSecrets(stderrBuf),
        durationMs: Date.now() - startTime,
      });
    };

    child.on('error', (err) => {
      stderrBuf += `\nProcess spawn error: ${err.message}`;
      finish(1);
    });

    child.on('close', async (code) => {
      if (termination) await termination;
      finish(code);
    });
  });
}
