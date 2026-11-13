import { PlatformId } from './finding';

export type FrameworkType = 'nextjs' | 'react-vite' | 'express' | 'unknown';
export type PackageManagerType = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export interface ServicePackageInfo {
  relativePath: string;
  name: string;
  framework: FrameworkType;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines?: Record<string, string>;
  main?: string;
  hasTypeScript: boolean;
}

export interface EnvVarUsageFact {
  name: string;
  file: string;
  line: number;
  column: number;
  isClientFile: boolean;
  hasFallback: boolean;
  isTestFile: boolean;
}

export interface LocalhostUsageFact {
  urlOrHost: string;
  file: string;
  line: number;
  column: number;
  isClientFile: boolean;
  hasEnvFallback: boolean;
  isTestFile: boolean;
  isServerListenLog: boolean;
}

export interface SqliteUsageFact {
  driverOrPattern: string;
  file: string;
  line: number;
  column: number;
  dbPath?: string;
  isInMemory: boolean;
  isTestFile: boolean;
}

export interface ListenCallFact {
  file: string;
  line: number;
  column: number;
  usesProcessEnvPort: boolean;
  hardcodedPort?: number;
  hostAddress?: string;
  isConditionalServerlessGuard: boolean;
  exportsServerlessApp: boolean;
}

export interface CorsUsageFact {
  file: string;
  line: number;
  column: number;
  originValue: string;
  isHardcodedLocalhost: boolean;
  usesWildcardWithCredentials: boolean;
}

export interface FileUploadFact {
  file: string;
  line: number;
  column: number;
  library: string;
  destinationPath?: string;
  isTempDir: boolean;
  isTestFile: boolean;
}

export interface LongRunningProcessFact {
  file: string;
  line: number;
  column: number;
  kind: 'cron' | 'worker-queue' | 'websocket-server' | 'setInterval-daemon' | 'child-process-daemon';
  evidence: string;
  isTestFile: boolean;
}

export interface DatabaseMigrationFact {
  hasPrisma: boolean;
  hasDrizzle: boolean;
  hasTypeOrm: boolean;
  hasKnex: boolean;
  hasSequelize: boolean;
  hasSupabase: boolean;
  hasPostgres: boolean;
  prismaSchemaPath?: string;
  hasMigrateOrGenerateScript: boolean;
  hasDestructiveDropOrResetInStart: boolean;
  destructiveScriptFile?: string;
  destructiveScriptEvidence?: string;
}

export interface DeploymentConfigFacts {
  vercelJsonPath?: string;
  vercelJsonRaw?: Record<string, unknown>;
  vercelJsonParseError?: string;
  railwayJsonPath?: string;
  railwayJsonRaw?: Record<string, unknown>;
  railwayJsonParseError?: string;
  railwayTomlPath?: string;
  railwayTomlRaw?: Record<string, unknown>;
  railwayTomlParseError?: string;
  procfilePath?: string;
  procfileContent?: string;
  dockerfilePath?: string;
  nextConfigPath?: string;
  nextConfigContent?: string;
  viteConfigPath?: string;
  viteConfigContent?: string;
}

export interface EnvFilesFacts {
  envFilesFound: string[];
  envExampleFilesFound: string[];
  definedInEnvFiles: Set<string>;
  definedInEnvExample: Set<string>;
}

export interface ProjectManifest {
  rootDir: string;
  detectedFrameworks: FrameworkType[];
  primaryFramework: FrameworkType;
  isMonorepo: boolean;
  packageManagers: PackageManagerType[];
  primaryPackageManager: PackageManagerType;
  rootPackageJson?: ServicePackageInfo;
  services: ServicePackageInfo[];
  inferredPlatforms: PlatformId[];
  filesScanned: string[];
  skippedFiles: Array<{ file: string; reason: string }>;
  envFacts: EnvFilesFacts;
  envUsages: EnvVarUsageFact[];
  localhostUsages: LocalhostUsageFact[];
  sqliteUsages: SqliteUsageFact[];
  listenCalls: ListenCallFact[];
  corsUsages: CorsUsageFact[];
  fileUploads: FileUploadFact[];
  longRunningProcesses: LongRunningProcessFact[];
  databaseFacts: DatabaseMigrationFact;
  configFacts: DeploymentConfigFacts;
  parseErrors: Array<{ file: string; error: string }>;
}
