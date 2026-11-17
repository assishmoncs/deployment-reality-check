import * as path from 'path';
import {
  CorsUsageFact,
  DatabaseMigrationFact,
  EnvVarUsageFact,
  FileUploadFact,
  ListenCallFact,
  LocalhostUsageFact,
  LongRunningProcessFact,
  ServicePackageInfo,
  SqliteUsageFact,
} from '../core/project-manifest';
import { readTextFileSafe } from '../utils/fs-safe';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const babelParser = require('@babel/parser');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const babelTraverse = require('@babel/traverse').default || require('@babel/traverse');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

interface AstPosition {
  line: number;
  column: number;
}

interface AstNode {
  type: string;
  loc?: { start: AstPosition } | null;
  start?: number | null;
  end?: number | null;
  name?: string;
  value?: unknown;
  computed?: boolean;
  operator?: string;
  object?: AstNode;
  property?: AstNode;
  left?: AstNode;
  right?: AstNode;
  callee?: AstNode;
  arguments?: AstNode[];
  properties?: AstNode[];
  key?: AstNode;
  init?: AstNode | null;
  source?: AstNode;
  quasis?: Array<{ value: { raw: string } }>;
}

interface AstBinding {
  path: {
    node: AstNode;
    parent?: AstNode;
  };
}

interface AstNodePath {
  node: AstNode;
  parent: AstNode;
  scope: {
    getBinding(name: string): AstBinding | undefined;
  };
  isCallExpression(): boolean;
  isIfStatement(): boolean;
  findParent(predicate: (ancestor: AstNodePath) => boolean): AstNodePath | null;
}

function isExpressApp(receiver: AstNode | undefined, call: AstNodePath): boolean {
  const app = receiver?.name ? call.scope.getBinding(receiver.name)?.path.node.init : undefined;
  const factoryName = app?.type === 'CallExpression' ? app.callee?.name : undefined;
  const factory = factoryName ? call.scope.getBinding(factoryName)?.path : undefined;
  if (factory?.node.type === 'ImportDefaultSpecifier') {
    return factory.parent?.source?.value === 'express';
  }
  const init = factory?.node.init;
  return (
    init?.type === 'CallExpression' &&
    init.callee?.name === 'require' &&
    init.arguments?.[0]?.value === 'express'
  );
}

export function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return (
    normalized.includes('.test.') ||
    normalized.includes('.spec.') ||
    normalized.includes('__tests__/') ||
    normalized.startsWith('tests/') ||
    normalized.startsWith('test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/test/') ||
    normalized.endsWith('vitest.config.ts') ||
    normalized.endsWith('jest.config.js') ||
    normalized.endsWith('jest.config.ts')
  );
}

export function isClientSideFile(
  filePath: string,
  code: string,
  services: ServicePackageInfo[],
): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  // Explicit Next.js 'use client' directive at top of file
  if (/^\s*['"]use client['"]/.test(code)) {
    return true;
  }

  // Explicit 'use server' directive is always server-side
  if (/^\s*['"]use server['"]/.test(code)) {
    return false;
  }

  // Server API route paths are server-side
  if (
    normalized.includes('/pages/api/') ||
    normalized.startsWith('pages/api/') ||
    normalized.includes('/app/api/') ||
    normalized.startsWith('app/api/') ||
    normalized.includes('/server/') ||
    normalized.startsWith('server/') ||
    normalized.includes('/backend/') ||
    normalized.startsWith('backend/')
  ) {
    return false;
  }

  // Next.js App Router files without 'use client' are Server Components by default
  const isNextAppRouterFile =
    normalized.startsWith('app/') ||
    normalized.startsWith('src/app/') ||
    normalized.includes('/app/') ||
    normalized.includes('/src/app/');
  const belongsToNextService = services.some((s) => s.framework === 'nextjs');
  if (belongsToNextService && isNextAppRouterFile) {
    return false;
  }

  // JSX/TSX files outside server/api and Next.js App Router directories are client components
  if (normalized.endsWith('.tsx') || normalized.endsWith('.jsx')) {
    return true;
  }

  // Files inside client/frontend service or src/components, src/hooks
  if (
    normalized.startsWith('client/') ||
    normalized.startsWith('frontend/') ||
    normalized.includes('/components/') ||
    normalized.startsWith('components/') ||
    normalized.includes('/hooks/')
  ) {
    return true;
  }

  // Check if file belongs to a react-vite service
  for (const svc of services) {
    if (svc.framework === 'react-vite') {
      if (svc.relativePath === '.' || normalized.startsWith(`${svc.relativePath}/`)) {
        if (!normalized.endsWith('vite.config.ts') && !normalized.endsWith('vite.config.js')) {
          return true;
        }
      }
    }
  }

  return false;
}

export interface SourceAnalysisResult {
  envUsages: EnvVarUsageFact[];
  localhostUsages: LocalhostUsageFact[];
  sqliteUsages: SqliteUsageFact[];
  listenCalls: ListenCallFact[];
  corsUsages: CorsUsageFact[];
  fileUploads: FileUploadFact[];
  longRunningProcesses: LongRunningProcessFact[];
  databaseFacts: DatabaseMigrationFact;
  parseErrors: Array<{ file: string; error: string }>;
}

export function analyzeSourceFiles(
  rootDir: string,
  allFiles: string[],
  services: ServicePackageInfo[],
): SourceAnalysisResult {
  const envUsages: EnvVarUsageFact[] = [];
  const localhostUsages: LocalhostUsageFact[] = [];
  const sqliteUsages: SqliteUsageFact[] = [];
  const listenCalls: ListenCallFact[] = [];
  const corsUsages: CorsUsageFact[] = [];
  const fileUploads: FileUploadFact[] = [];
  const longRunningProcesses: LongRunningProcessFact[] = [];
  const parseErrors: Array<{ file: string; error: string }> = [];

  let hasPrisma = false;
  let hasDrizzle = false;
  let hasTypeOrm = false;
  let hasKnex = false;
  let hasSequelize = false;
  let hasSupabase = false;
  let hasPostgres = false;
  let hasMigrateOrGenerateScript = false;
  let hasDestructiveDropOrResetInStart = false;
  let destructiveScriptFile: string | undefined;
  let destructiveScriptEvidence: string | undefined;

  for (const svc of services) {
    const deps = { ...svc.devDependencies, ...svc.dependencies };
    if (deps.prisma || deps['@prisma/client']) hasPrisma = true;
    if (deps['drizzle-orm'] || deps['drizzle-kit']) hasDrizzle = true;
    if (deps.typeorm) hasTypeOrm = true;
    if (deps.knex) hasKnex = true;
    if (deps.sequelize) hasSequelize = true;
    if (deps['@supabase/supabase-js']) hasSupabase = true;
    if (deps.pg || deps.postgres) hasPostgres = true;

    if (deps.sqlite3 || deps['better-sqlite3'] || deps['sql.js']) {
      const pkgPath =
        svc.relativePath === '.' ? 'package.json' : `${svc.relativePath}/package.json`;
      sqliteUsages.push({
        driverOrPattern:
          Object.keys(deps).find((k) => k.includes('sqlite') || k === 'sql.js') ?? 'sqlite3',
        file: pkgPath,
        line: 1,
        column: 1,
        isInMemory: false,
        isTestFile: false,
      });
    }

    for (const [scriptName, scriptCmd] of Object.entries(svc.scripts)) {
      if (
        /prisma\s+(generate|migrate\s+deploy|db\s+push)|drizzle-kit\s+migrate|knex\s+migrate|typeorm\s+migration/i.test(
          scriptCmd,
        )
      ) {
        hasMigrateOrGenerateScript = true;
      }
      if (
        (scriptName === 'start' ||
          scriptName === 'build' ||
          scriptName === 'postinstall' ||
          scriptName === 'prestart') &&
        /prisma\s+migrate\s+reset|--force-reset|DROP\s+TABLE|db\s+push\s+--force-reset/i.test(
          scriptCmd,
        )
      ) {
        hasDestructiveDropOrResetInStart = true;
        destructiveScriptFile =
          svc.relativePath === '.' ? 'package.json' : `${svc.relativePath}/package.json`;
        destructiveScriptEvidence = `"${scriptName}": "${scriptCmd}"`;
      }
    }
  }

  const prismaSchemaPath = allFiles.find(
    (f) => f === 'prisma/schema.prisma' || f.endsWith('/prisma/schema.prisma'),
  );
  if (prismaSchemaPath) {
    hasPrisma = true;
    const schemaRead = readTextFileSafe(rootDir, prismaSchemaPath);
    if (schemaRead.content) {
      const providerMatch = schemaRead.content.match(/provider\s*=\s*"([^"]+)"/);
      if (providerMatch && providerMatch[1] === 'sqlite') {
        const lines = schemaRead.content.split(/\r?\n/);
        const lineIdx = lines.findIndex((l) => l.includes('provider') && l.includes('sqlite'));
        sqliteUsages.push({
          driverOrPattern: 'prisma-provider-sqlite',
          file: prismaSchemaPath,
          line: lineIdx >= 0 ? lineIdx + 1 : 1,
          column: 1,
          dbPath: 'file:./dev.db',
          isInMemory: false,
          isTestFile: false,
        });
      }
    }
  }

  for (const file of allFiles) {
    const ext = path.posix.extname(file).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const readRes = readTextFileSafe(rootDir, file);
    if (!readRes.content) continue;
    const code = readRes.content;
    const isTest = isTestFilePath(file);
    const serviceDir = services.reduce((closest, service) => {
      const relative = service.relativePath;
      return file.startsWith(`${relative}/`) && relative.length > closest.length
        ? relative
        : closest;
    }, '');
    const serviceFile = serviceDir ? file.slice(serviceDir.length + 1) : file;
    const vercelEntrypoint = /^(?:src\/)?(?:app|index|server)\.(?:js|cjs|mjs|ts|cts|mts)$/.test(
      serviceFile,
    );
    const isClient = isClientSideFile(file, code, services);

    let ast: unknown;
    try {
      ast = babelParser.parse(code, {
        sourceType: 'unambiguous',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'topLevelAwait',
          'dynamicImport',
        ],
        errorRecovery: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parseErrors.push({ file, error: msg });
      continue;
    }

    let fileExportsServerlessHandler = false;
    babelTraverse(ast, {
      ExportDefaultDeclaration() {
        fileExportsServerlessHandler = true;
      },
      AssignmentExpression(p: AstNodePath) {
        const left = p.node.left;
        if (
          left &&
          left.type === 'MemberExpression' &&
          left.object?.type === 'Identifier' &&
          left.object.name === 'module' &&
          left.property?.type === 'Identifier' &&
          left.property.name === 'exports'
        ) {
          fileExportsServerlessHandler = true;
        }
      },
    });

    babelTraverse(ast, {
      MemberExpression(p: AstNodePath) {
        const node = p.node;
        const loc = node.loc?.start ?? { line: 1, column: 0 };

        if (
          node.object?.type === 'MemberExpression' &&
          node.object.object?.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property?.type === 'Identifier' &&
          node.object.property.name === 'env' &&
          node.property?.type === 'Identifier' &&
          node.property.name &&
          !node.computed
        ) {
          const varName = node.property.name;
          const parent = p.parent;
          const hasFallback =
            (parent.type === 'LogicalExpression' &&
              (parent.operator === '||' || parent.operator === '??') &&
              parent.left === node) ||
            parent.type === 'ConditionalExpression';

          envUsages.push({
            name: varName,
            file,
            line: loc.line,
            column: loc.column + 1,
            isClientFile: isClient,
            hasFallback,
            isTestFile: isTest,
          });
        }

        if (
          node.object?.type === 'MemberExpression' &&
          node.object.object?.type === 'MetaProperty' &&
          node.object.property?.type === 'Identifier' &&
          node.object.property.name === 'env' &&
          node.property?.type === 'Identifier' &&
          node.property.name &&
          !node.computed
        ) {
          const varName = node.property.name;
          const parent = p.parent;
          const hasFallback =
            (parent.type === 'LogicalExpression' &&
              (parent.operator === '||' || parent.operator === '??') &&
              parent.left === node) ||
            parent.type === 'ConditionalExpression';

          envUsages.push({
            name: varName,
            file,
            line: loc.line,
            column: loc.column + 1,
            isClientFile: true,
            hasFallback,
            isTestFile: isTest,
          });
        }
      },

      StringLiteral(p: AstNodePath) {
        const val = typeof p.node.value === 'string' ? p.node.value : '';
        if (!val) return;
        const loc = p.node.loc?.start ?? { line: 1, column: 0 };

        if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(val)) {
          const isInsideCorsCall = Boolean(
            p.findParent(
              (anc: AstNodePath) =>
                anc.isCallExpression() &&
                anc.node.callee?.type === 'Identifier' &&
                anc.node.callee.name === 'cors',
            ),
          );
          if (isInsideCorsCall) return;

          const isFallbackRight =
            p.parent.type === 'LogicalExpression' &&
            (p.parent.operator === '||' || p.parent.operator === '??') &&
            p.parent.right === p.node;

          const isConsoleCall = Boolean(
            p.findParent(
              (anc: AstNodePath) =>
                anc.isCallExpression() &&
                anc.node.callee?.type === 'MemberExpression' &&
                anc.node.callee.object?.type === 'Identifier' &&
                anc.node.callee.object.name === 'console',
            ),
          );

          localhostUsages.push({
            urlOrHost: val,
            file,
            line: loc.line,
            column: loc.column + 1,
            isClientFile: isClient,
            hasEnvFallback: isFallbackRight,
            isTestFile: isTest,
            isServerListenLog: isConsoleCall,
          });
        }

        if (
          /\.(sqlite|sqlite3|db)$/i.test(val) ||
          val.startsWith('sqlite:') ||
          val === ':memory:'
        ) {
          sqliteUsages.push({
            driverOrPattern: val,
            file,
            line: loc.line,
            column: loc.column + 1,
            dbPath: val,
            isInMemory: val === ':memory:' || val.includes(':memory:'),
            isTestFile: isTest,
          });
        }

        if (!isTest && /DROP\s+TABLE\s+/i.test(val) && /CREATE\s+TABLE/i.test(val)) {
          hasDestructiveDropOrResetInStart = true;
          destructiveScriptFile = file;
          destructiveScriptEvidence = val.slice(0, 80);
        }
      },

      TemplateLiteral(p: AstNodePath) {
        const quasis = p.node.quasis ?? [];
        const rawQuasis = quasis.map((q) => q.value.raw).join('${...}');
        const loc = p.node.loc?.start ?? { line: 1, column: 0 };
        if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(rawQuasis)) {
          const isConsoleCall = Boolean(
            p.findParent(
              (anc: AstNodePath) =>
                anc.isCallExpression() &&
                anc.node.callee?.type === 'MemberExpression' &&
                anc.node.callee.object?.type === 'Identifier' &&
                anc.node.callee.object.name === 'console',
            ),
          );
          const isFallbackRight =
            p.parent.type === 'LogicalExpression' &&
            (p.parent.operator === '||' || p.parent.operator === '??') &&
            p.parent.right === p.node;

          localhostUsages.push({
            urlOrHost: rawQuasis,
            file,
            line: loc.line,
            column: loc.column + 1,
            isClientFile: isClient,
            hasEnvFallback: isFallbackRight,
            isTestFile: isTest,
            isServerListenLog: isConsoleCall,
          });
        }
      },

      CallExpression(p: AstNodePath) {
        const node = p.node;
        const loc = node.loc?.start ?? { line: 1, column: 0 };
        const callArgs = node.arguments ?? [];

        if (
          !isTest &&
          node.callee?.type === 'MemberExpression' &&
          node.callee.property?.type === 'Identifier' &&
          node.callee.property.name === 'listen' &&
          callArgs.length >= 1
        ) {
          const firstArg = callArgs[0]!;
          const secondArg = callArgs[1];

          let usesProcessEnvPort = false;
          let hardcodedPort: number | undefined;
          let hostAddress: string | undefined;

          if (firstArg.type === 'NumericLiteral' && typeof firstArg.value === 'number') {
            hardcodedPort = firstArg.value;
          } else {
            const argSource = code.slice(firstArg.start ?? 0, firstArg.end ?? 0);
            if (/process\.env\.PORT/.test(argSource)) {
              usesProcessEnvPort = true;
            } else if (firstArg.type === 'Identifier' && firstArg.name) {
              const binding = p.scope.getBinding(firstArg.name);
              if (binding && binding.path.node.init) {
                const initNode = binding.path.node.init;
                const initText = code.slice(initNode.start ?? 0, initNode.end ?? 0);
                if (/process\.env\.PORT/.test(initText)) {
                  usesProcessEnvPort = true;
                } else if (
                  initNode.type === 'NumericLiteral' &&
                  typeof initNode.value === 'number'
                ) {
                  hardcodedPort = initNode.value;
                }
              }
            }
          }

          if (
            secondArg &&
            secondArg.type === 'StringLiteral' &&
            typeof secondArg.value === 'string'
          ) {
            hostAddress = secondArg.value;
          }

          const isConditionalServerlessGuard = Boolean(
            p.findParent((anc: AstNodePath) => anc.isIfStatement()),
          );

          listenCalls.push({
            file,
            line: loc.line,
            column: loc.column + 1,
            usesProcessEnvPort,
            hardcodedPort,
            hostAddress,
            isConditionalServerlessGuard,
            exportsServerlessApp: fileExportsServerlessHandler,
            isVercelExpressEntrypoint: vercelEntrypoint && isExpressApp(node.callee.object, p),
          });
        }

        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'cors' &&
          callArgs.length >= 1 &&
          callArgs[0]?.type === 'ObjectExpression'
        ) {
          const obj = callArgs[0]!;
          let originValue = '';
          let credentialsTrue = false;

          for (const prop of obj.properties ?? []) {
            if (prop.type === 'ObjectProperty' && prop.key?.type === 'Identifier') {
              if (prop.key.name === 'origin' && prop.right === undefined && prop.value) {
                const valNode = prop.value as AstNode;
                originValue = code.slice(valNode.start ?? 0, valNode.end ?? 0);
              }
              if (prop.key.name === 'credentials' && prop.value) {
                const valNode = prop.value as AstNode;
                if (valNode.type === 'BooleanLiteral') {
                  credentialsTrue = valNode.value === true;
                }
              }
            }
          }

          if (originValue) {
            const isHardcodedLocalhost =
              /localhost|127\.0\.0\.1/i.test(originValue) && !/process\.env/.test(originValue);
            const usesWildcardWithCredentials =
              credentialsTrue && (originValue === "'*'" || originValue === '"*"');

            corsUsages.push({
              file,
              line: loc.line,
              column: loc.column + 1,
              originValue,
              isHardcodedLocalhost,
              usesWildcardWithCredentials,
            });
          }
        }

        if (
          (node.callee?.type === 'Identifier' && node.callee.name === 'multer') ||
          (node.callee?.type === 'MemberExpression' &&
            node.callee.object?.type === 'Identifier' &&
            node.callee.object.name === 'multer' &&
            node.callee.property?.type === 'Identifier' &&
            node.callee.property.name === 'diskStorage')
        ) {
          const arg0 = callArgs[0];
          let destText = 'local-disk';
          if (arg0 && arg0.type === 'ObjectExpression') {
            for (const prop of arg0.properties ?? []) {
              if (
                prop.type === 'ObjectProperty' &&
                prop.key?.type === 'Identifier' &&
                (prop.key.name === 'dest' || prop.key.name === 'destination') &&
                prop.value
              ) {
                const valNode = prop.value as AstNode;
                destText = code.slice(valNode.start ?? 0, valNode.end ?? 0);
              }
            }
          }
          if (destText !== 'local-disk' || node.callee?.type === 'MemberExpression') {
            const isTempDir = /\/tmp|os\.tmpdir/.test(destText);
            fileUploads.push({
              file,
              line: loc.line,
              column: loc.column + 1,
              library: 'multer',
              destinationPath: destText,
              isTempDir,
              isTestFile: isTest,
            });
          }
        }

        if (
          node.callee?.type === 'MemberExpression' &&
          node.callee.property?.type === 'Identifier' &&
          node.callee.property.name &&
          ['writeFile', 'writeFileSync', 'createWriteStream'].includes(node.callee.property.name) &&
          callArgs.length >= 1
        ) {
          const firstArg = callArgs[0]!;
          const targetArg = code.slice(firstArg.start ?? 0, firstArg.end ?? 0);
          if (/uploads|avatars|media|public\/uploads|storage/i.test(targetArg)) {
            fileUploads.push({
              file,
              line: loc.line,
              column: loc.column + 1,
              library: `fs.${node.callee.property.name}`,
              destinationPath: targetArg,
              isTempDir: /\/tmp|os\.tmpdir/.test(targetArg),
              isTestFile: isTest,
            });
          }
        }

        if (
          node.callee?.type === 'MemberExpression' &&
          node.callee.property?.type === 'Identifier' &&
          node.callee.property.name === 'schedule' &&
          node.callee.object?.type === 'Identifier' &&
          (node.callee.object.name === 'cron' || node.callee.object.name === 'nodeCron')
        ) {
          longRunningProcesses.push({
            file,
            line: loc.line,
            column: loc.column + 1,
            kind: 'cron',
            evidence: code.slice(node.start ?? 0, Math.min(node.end ?? 0, (node.start ?? 0) + 80)),
            isTestFile: isTest,
          });
        }

        if (node.callee?.type === 'Identifier' && node.callee.name === 'setInterval' && !isClient) {
          longRunningProcesses.push({
            file,
            line: loc.line,
            column: loc.column + 1,
            kind: 'setInterval-daemon',
            evidence: 'setInterval(...) background loop in server/API code',
            isTestFile: isTest,
          });
        }
      },

      NewExpression(p: AstNodePath) {
        const node = p.node;
        const loc = node.loc?.start ?? { line: 1, column: 0 };
        const newArgs = node.arguments ?? [];
        if (node.callee?.type === 'Identifier' && node.callee.name) {
          const name = node.callee.name;
          if (name === 'WebSocketServer' || (name === 'Server' && code.includes('socket.io'))) {
            longRunningProcesses.push({
              file,
              line: loc.line,
              column: loc.column + 1,
              kind: 'websocket-server',
              evidence: `new ${name}(...) persistent stateful WebSocket server`,
              isTestFile: isTest,
            });
          }
          if (name === 'Worker' && (code.includes('bullmq') || code.includes('bull'))) {
            longRunningProcesses.push({
              file,
              line: loc.line,
              column: loc.column + 1,
              kind: 'worker-queue',
              evidence: `new Worker(...) persistent background queue worker`,
              isTestFile: isTest,
            });
          }
          if (name === 'Database') {
            const firstArg = newArgs[0];
            const dbArg =
              firstArg && firstArg.type === 'StringLiteral' && typeof firstArg.value === 'string'
                ? firstArg.value
                : 'local.db';
            sqliteUsages.push({
              driverOrPattern: 'new Database(...)',
              file,
              line: loc.line,
              column: loc.column + 1,
              dbPath: dbArg,
              isInMemory: dbArg === ':memory:' || dbArg.includes(':memory:'),
              isTestFile: isTest,
            });
          }
        }
      },
    });
  }

  return {
    envUsages,
    localhostUsages,
    sqliteUsages,
    listenCalls,
    corsUsages,
    fileUploads,
    longRunningProcesses,
    databaseFacts: {
      hasPrisma,
      hasDrizzle,
      hasTypeOrm,
      hasKnex,
      hasSequelize,
      hasSupabase,
      hasPostgres,
      prismaSchemaPath,
      hasMigrateOrGenerateScript,
      hasDestructiveDropOrResetInStart,
      destructiveScriptFile,
      destructiveScriptEvidence,
    },
    parseErrors,
  };
}
