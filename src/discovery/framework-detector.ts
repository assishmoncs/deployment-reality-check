import { FrameworkType, ServicePackageInfo } from '../core/project-manifest';

export function detectFrameworkFromDeps(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  serviceDir: string,
  allFiles: string[],
): FrameworkType {
  const allDeps = { ...devDependencies, ...dependencies };

  const prefix = serviceDir === '.' ? '' : `${serviceDir}/`;
  const hasNextConfig = allFiles.some(
    (f) =>
      f === `${prefix}next.config.js` ||
      f === `${prefix}next.config.mjs` ||
      f === `${prefix}next.config.ts`,
  );

  if (allDeps.next || hasNextConfig) {
    return 'nextjs';
  }

  const hasViteConfig = allFiles.some(
    (f) =>
      f === `${prefix}vite.config.ts` ||
      f === `${prefix}vite.config.js` ||
      f === `${prefix}vite.config.mjs`,
  );

  if ((allDeps.react && allDeps.vite) || (allDeps.react && hasViteConfig) || hasViteConfig) {
    return 'react-vite';
  }

  if (allDeps.express) {
    return 'express';
  }

  return 'unknown';
}

export function summarizeProjectFrameworks(services: ServicePackageInfo[]): {
  detectedFrameworks: FrameworkType[];
  primaryFramework: FrameworkType;
  isMonorepo: boolean;
} {
  const set = new Set<FrameworkType>();
  for (const svc of services) {
    if (svc.framework !== 'unknown') {
      set.add(svc.framework);
    }
  }

  const detectedFrameworks = Array.from(set);
  let primaryFramework: FrameworkType = 'unknown';
  if (detectedFrameworks.includes('nextjs')) {
    primaryFramework = 'nextjs';
  } else if (detectedFrameworks.includes('express')) {
    primaryFramework = 'express';
  } else if (detectedFrameworks.includes('react-vite')) {
    primaryFramework = 'react-vite';
  }

  const nonRootServices = services.filter((s) => s.relativePath !== '.');
  const isMonorepo =
    nonRootServices.length >= 2 || (services.length >= 2 && detectedFrameworks.length >= 2);

  return {
    detectedFrameworks,
    primaryFramework,
    isMonorepo,
  };
}
