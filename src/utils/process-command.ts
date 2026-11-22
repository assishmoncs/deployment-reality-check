import { PackageManagerType } from '../core/project-manifest';

export function packageManagerCommand(packageManager: PackageManagerType): string {
  const bin = ['yarn', 'pnpm', 'bun'].includes(packageManager) ? packageManager : 'npm';
  return process.platform === 'win32' && bin !== 'bun' ? `${bin}.cmd` : bin;
}

export function resolveProcessCommand(command: string, args: string[]) {
  // Windows package-manager shims require cmd.exe. Only pass fixed script commands to it.
  const script = args[1];
  if (
    process.platform === 'win32' &&
    /^(?:npm|yarn|pnpm)\.cmd$/i.test(command) &&
    args.length === 2 &&
    args[0] === 'run' &&
    (script === 'build' || script === 'start')
  ) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `${command} run ${script}`],
    };
  }
  return { command, args };
}
