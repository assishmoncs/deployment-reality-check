import * as path from 'path';
import { PlatformId } from '../core/finding';
import { ProjectManifest } from '../core/project-manifest';
import { discoverDeploymentConfigs } from './config-reader';
import { discoverDependencies } from './dependency-reader';
import { walkProjectFiles, WalkOptions } from './file-walker';
import { summarizeProjectFrameworks } from './framework-detector';
import { analyzeSourceFiles } from './source-analyzer';

export function discoverProject(rootDir: string, walkOptions?: WalkOptions): ProjectManifest {
  const resolvedRoot = path.resolve(rootDir);
  const walked = walkProjectFiles(resolvedRoot, walkOptions);
  const depInfo = discoverDependencies(resolvedRoot, walked.files);
  const fwSummary = summarizeProjectFrameworks(depInfo.services);
  const cfgInfo = discoverDeploymentConfigs(resolvedRoot, walked.files);
  const srcInfo = analyzeSourceFiles(resolvedRoot, walked.files, depInfo.services);

  return {
    rootDir: resolvedRoot,
    detectedFrameworks: fwSummary.detectedFrameworks,
    primaryFramework: fwSummary.primaryFramework,
    isMonorepo: fwSummary.isMonorepo,
    packageManagers: depInfo.packageManagers,
    primaryPackageManager: depInfo.primaryPackageManager,
    rootPackageJson: depInfo.rootPackageJson,
    services: depInfo.services,
    inferredPlatforms: cfgInfo.inferredPlatforms,
    filesScanned: walked.files,
    skippedFiles: walked.skipped,
    envFacts: cfgInfo.envFacts,
    envUsages: srcInfo.envUsages,
    localhostUsages: srcInfo.localhostUsages,
    sqliteUsages: srcInfo.sqliteUsages,
    listenCalls: srcInfo.listenCalls,
    corsUsages: srcInfo.corsUsages,
    fileUploads: srcInfo.fileUploads,
    longRunningProcesses: srcInfo.longRunningProcesses,
    databaseFacts: srcInfo.databaseFacts,
    configFacts: cfgInfo.configFacts,
    parseErrors: [...depInfo.parseErrors, ...cfgInfo.parseErrors, ...srcInfo.parseErrors],
  };
}

export function getProjectParseErrors(
  manifest: ProjectManifest,
  platform: PlatformId,
): ProjectManifest['parseErrors'] {
  return manifest.parseErrors.filter(({ file }) => {
    const name = path.posix.basename(file);
    if (name === 'vercel.json') return platform === 'vercel';
    if (name === 'railway.json' || name === 'railway.toml') return platform === 'railway';
    return true;
  });
}
