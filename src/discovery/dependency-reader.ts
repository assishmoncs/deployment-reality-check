import * as path from 'path';
import { PackageManagerType, ServicePackageInfo } from '../core/project-manifest';
import { readTextFileSafe, normalizePosixPath } from '../utils/fs-safe';
import { validateJsonSafe } from '../utils/schema';
import { detectFrameworkFromDeps } from './framework-detector';

export interface DependencyDiscoveryResult {
  packageManagers: PackageManagerType[];
  primaryPackageManager: PackageManagerType;
  rootPackageJson?: ServicePackageInfo;
  services: ServicePackageInfo[];
  parseErrors: Array<{ file: string; error: string }>;
}

export function discoverDependencies(
  rootDir: string,
  allFiles: string[],
): DependencyDiscoveryResult {
  const managersByLockfile = new Map<string, PackageManagerType>([
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ]);
  const packageManagers = new Set<PackageManagerType>();
  let rootLockManager: PackageManagerType | undefined;
  let declaredRootManager: PackageManagerType | undefined;

  for (const file of allFiles) {
    const base = path.posix.basename(file);
    const manager = managersByLockfile.get(base);
    if (manager) {
      packageManagers.add(manager);
      if (file === base) rootLockManager ??= manager;
    }
  }

  const packageJsonFiles = allFiles.filter(
    (f) => f === 'package.json' || f.endsWith('/package.json'),
  );

  const services: ServicePackageInfo[] = [];
  const parseErrors: Array<{ file: string; error: string }> = [];
  let rootPackageJson: ServicePackageInfo | undefined;

  for (const pkgFile of packageJsonFiles) {
    const readRes = readTextFileSafe(rootDir, pkgFile);
    if (readRes.content === null) continue;

    const validated = validateJsonSafe(readRes.content, pkgFile);
    if (!validated.success || !validated.data) {
      parseErrors.push({
        file: pkgFile,
        error: validated.issues.map((i) => i.message).join('; '),
      });
      continue;
    }

    const data = validated.data;
    const rawDeps = (data.dependencies as Record<string, unknown> | undefined) ?? {};
    const rawDevDeps = (data.devDependencies as Record<string, unknown> | undefined) ?? {};
    const rawScripts = (data.scripts as Record<string, unknown> | undefined) ?? {};
    const rawEngines = (data.engines as Record<string, unknown> | undefined) ?? undefined;

    const dependencies: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawDeps)) {
      if (typeof v === 'string') dependencies[k] = v;
    }

    const devDependencies: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawDevDeps)) {
      if (typeof v === 'string') devDependencies[k] = v;
    }

    const scripts: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawScripts)) {
      if (typeof v === 'string') scripts[k] = v;
    }

    const engines: Record<string, string> | undefined = rawEngines
      ? Object.fromEntries(
          Object.entries(rawEngines).filter(([, v]) => typeof v === 'string') as Array<
            [string, string]
          >,
        )
      : undefined;

    const relDir = normalizePosixPath(path.posix.dirname(pkgFile));
    const serviceDir = relDir === '.' ? '.' : relDir;
    const hasTsConfig = allFiles.includes(
      serviceDir === '.' ? 'tsconfig.json' : `${serviceDir}/tsconfig.json`,
    );
    const hasTypeScript =
      hasTsConfig || Boolean(dependencies.typescript || devDependencies.typescript);

    const framework = detectFrameworkFromDeps(dependencies, devDependencies, serviceDir, allFiles);

    const info: ServicePackageInfo = {
      relativePath: serviceDir,
      name: typeof data.name === 'string' ? data.name : serviceDir,
      framework,
      scripts,
      dependencies,
      devDependencies,
      engines,
      main: typeof data.main === 'string' ? data.main : undefined,
      hasTypeScript,
    };

    if (pkgFile === 'package.json') {
      rootPackageJson = info;
      if (typeof data.packageManager === 'string') {
        const declared = /^(npm|yarn|pnpm|bun)@[^\s]+$/.exec(data.packageManager);
        declaredRootManager = declared?.[1] as PackageManagerType | undefined;
        if (declaredRootManager) packageManagers.add(declaredRootManager);
      }
    }
    services.push(info);
  }

  return {
    packageManagers: packageManagers.size > 0 ? Array.from(packageManagers) : ['unknown'],
    primaryPackageManager: declaredRootManager ?? rootLockManager ?? 'npm',
    rootPackageJson,
    services,
    parseErrors,
  };
}
