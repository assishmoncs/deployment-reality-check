import { PackageManagerType } from '../core/project-manifest';
import { packageManagerCommand } from '../utils/process-command';
import { BoundedProcessResult, runBoundedProcess } from './process-manager';

export interface BuildVerificationOptions {
  rootDir: string;
  packageManager: PackageManagerType;
  allowExec: boolean;
  timeoutMs?: number;
}

export interface BuildVerificationReport {
  executed: boolean;
  skippedReason?: string;
  success: boolean;
  result?: BoundedProcessResult;
}

export async function runProductionBuildCheck(
  options: BuildVerificationOptions,
): Promise<BuildVerificationReport> {
  if (!options.allowExec) {
    return {
      executed: false,
      skippedReason:
        'Build script execution skipped (requires explicit --allow-exec permission because third-party scripts are not sandboxed).',
      success: true,
    };
  }

  const result = await runBoundedProcess({
    cwd: options.rootDir,
    command: packageManagerCommand(options.packageManager),
    args: ['run', 'build'],
    timeoutMs: options.timeoutMs ?? 60000,
  });

  return {
    executed: true,
    success: !result.timedOut && result.exitCode === 0,
    result,
  };
}
