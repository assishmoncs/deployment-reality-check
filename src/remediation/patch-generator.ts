import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '../core/finding';
import { ProjectManifest } from '../core/project-manifest';
import { assertSafeProjectPath, readTextFileSafe } from '../utils/fs-safe';
import { generateSafeEnvPlaceholder, redactSecrets } from '../utils/redactor';
import { computeContentSha256, FixPlan, GuidedManualStep, ProposedPatch } from './fix-plan';
import { renderEnvExampleTemplate } from './templates/config-templates';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Diff = require('diff');

function replaceOnTargetLine(
  content: string,
  targetLine: number | undefined,
  matcher: RegExp,
  replacer: string,
): string {
  if (!targetLine || targetLine < 1) {
    return content.replace(matcher, replacer);
  }
  const lines = content.split('\n');
  const idx = targetLine - 1;
  if (idx >= 0 && idx < lines.length && matcher.test(lines[idx]!)) {
    lines[idx] = lines[idx]!.replace(matcher, replacer);
    return lines.join('\n');
  }
  return content.replace(matcher, replacer);
}

function createUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  const redact = (content: string) => {
    if (/^\.env(?:\.|$)/.test(path.posix.basename(filePath))) {
      // Keep variable names visible while withholding existing and proposed values.
      return content
        .split('\n')
        .map((line) => {
          const assignment = line.match(/^(\s*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=)/);
          if (assignment) return `${assignment[1]}[REDACTED]`;
          return line.trim() ? '[REDACTED]' : '';
        })
        .join('\n');
    }
    return redactSecrets(content);
  };
  const oldPreview = redact(oldText);
  const newPreview = redact(newText);
  if (oldPreview === newPreview) return 'Changes are hidden by secret redaction.';
  return Diff.createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldPreview,
    newPreview,
    '',
    '',
    {
      context: 3,
    },
  );
}

export function generateFixPlan(manifest: ProjectManifest, findings: Finding[]): FixPlan {
  const patches: ProposedPatch[] = [];
  const manualSteps: GuidedManualStep[] = [];

  // Track cumulative file contents in case multiple rules touch the same file
  const stagedFiles = new Map<string, { original: string; current: string; isNew: boolean }>();

  function getFileState(relFile: string): { original: string; current: string; isNew: boolean } {
    const existing = stagedFiles.get(relFile);
    if (existing) return existing;

    const safeFull = assertSafeProjectPath(manifest.rootDir, relFile);
    if (!fs.existsSync(safeFull)) {
      const state = { original: '', current: '', isNew: true };
      stagedFiles.set(relFile, state);
      return state;
    }
    const readRes = readTextFileSafe(manifest.rootDir, relFile);
    const content = readRes.content ?? '';
    const state = { original: content, current: content, isNew: false };
    stagedFiles.set(relFile, state);
    return state;
  }

  for (const finding of findings) {
    if (!finding.fix.eligible) {
      manualSteps.push({
        ruleId: finding.ruleId,
        title: finding.title,
        file: finding.file,
        line: finding.line,
        instructions: finding.suggestedFix,
        docsUrl: finding.docsUrl,
      });
      continue;
    }

    // 1. DRC001: Generate or append missing variables to .env.example
    if (finding.ruleId === 'DRC001') {
      const targetEnvFile = manifest.envFacts.envExampleFilesFound[0] ?? '.env.example';
      const state = getFileState(targetEnvFile);
      const requiredVars = new Set<string>();
      for (const u of manifest.envUsages) {
        if (!u.isTestFile && !u.hasFallback && !manifest.envFacts.definedInEnvExample.has(u.name)) {
          if (
            ![
              'NODE_ENV',
              'PORT',
              'HOST',
              'TZ',
              'CI',
              'VERCEL',
              'VERCEL_ENV',
              'VERCEL_URL',
              'RAILWAY_ENVIRONMENT',
              'RAILWAY_PUBLIC_DOMAIN',
            ].includes(u.name)
          ) {
            requiredVars.add(u.name);
          }
        }
      }

      const missingList = Array.from(requiredVars)
        .filter((v) => !new RegExp(`^\\s*${v}\\s*=`, 'm').test(state.current))
        .sort();

      if (missingList.length > 0) {
        let updated: string;
        if (state.current.trim() === '') {
          updated = renderEnvExampleTemplate(
            missingList.map((name) => ({
              name,
              placeholder: generateSafeEnvPlaceholder(name),
            })),
          );
        } else {
          const suffixLines = missingList.map(
            (name) => `${name}=${generateSafeEnvPlaceholder(name)}`,
          );
          const base = state.current.endsWith('\n') ? state.current : `${state.current}\n`;
          updated = `${base}${suffixLines.join('\n')}\n`;
        }

        if (updated !== state.current) {
          const prevContent = state.current;
          state.current = updated;
          patches.push({
            id: `patch-${finding.ruleId}-${targetEnvFile}`,
            ruleId: finding.ruleId,
            title: finding.fix.description,
            targetFile: targetEnvFile,
            safety: finding.fix.safety,
            isNewFile: state.isNew,
            originalContent: prevContent,
            originalSha256: computeContentSha256(prevContent),
            proposedContent: updated,
            unifiedDiff: createUnifiedDiff(targetEnvFile, prevContent, updated),
          });
        }
      }
      continue;
    }

    // 2. DRC004: Add missing build/start scripts to package.json
    if (finding.ruleId === 'DRC004' && finding.file) {
      const state = getFileState(finding.file);
      try {
        const pkgObj = JSON.parse(state.current) as Record<string, unknown>;
        const scripts = (pkgObj.scripts as Record<string, string> | undefined) ?? {};
        const svc = manifest.services.find(
          (s) =>
            (s.relativePath === '.' ? 'package.json' : `${s.relativePath}/package.json`) ===
            finding.file,
        );

        if (svc?.framework === 'nextjs') {
          if (!scripts.build && finding.fix.safety === 'safe-auto') {
            scripts.build = 'next build';
          }
          if (finding.platform === 'railway') {
            if (!scripts.start && finding.fix.safety === 'safe-auto') {
              scripts.start = 'next start';
            } else if (scripts.start && finding.fix.safety === 'approval-required') {
              scripts.start = scripts.start.replace(/\bnext dev\b/, 'next start');
            }
          }
        } else if (svc?.framework === 'react-vite') {
          if (!scripts.build) {
            scripts.build = 'vite build';
          }
        } else if (svc?.framework === 'express') {
          if (svc.hasTypeScript && !scripts.build) {
            scripts.build = 'tsc';
          }
          if (!scripts.start) {
            const entry = svc.main ?? (svc.hasTypeScript ? 'dist/index.js' : 'index.js');
            scripts.start = `node ${entry}`;
          } else if (
            finding.fix.safety === 'approval-required' &&
            /\b(nodemon|ts-node-dev)\b/.test(scripts.start)
          ) {
            if (!scripts.dev) {
              scripts.dev = scripts.start;
            }
            scripts.start = scripts.start
              .replace(/\b(nodemon|ts-node-dev)\b/, 'node')
              .replace(/\.ts\b/, '.js')
              .replace(/\bsrc\//, 'dist/');
          }
        }

        pkgObj.scripts = scripts;
        const updated = `${JSON.stringify(pkgObj, null, 2)}\n`;
        if (updated !== state.current) {
          const prevContent = state.current;
          state.current = updated;
          patches.push({
            id: `patch-${finding.ruleId}-${finding.file}`,
            ruleId: finding.ruleId,
            title: finding.fix.description,
            targetFile: finding.file,
            safety: finding.fix.safety,
            isNewFile: state.isNew,
            originalContent: prevContent,
            originalSha256: computeContentSha256(prevContent),
            proposedContent: updated,
            unifiedDiff: createUnifiedDiff(finding.file, prevContent, updated),
          });
        }
      } catch {
        manualSteps.push({
          ruleId: finding.ruleId,
          title: finding.title,
          file: finding.file,
          instructions: finding.suggestedFix,
        });
      }
      continue;
    }

    // 3. DRC002: Replace hardcoded localhost URL with env fallback
    if (finding.ruleId === 'DRC002' && finding.file) {
      const state = getFileState(finding.file);
      const usage = manifest.localhostUsages.find(
        (u) => u.file === finding.file && u.line === finding.line,
      );
      if (usage) {
        const envExpr =
          manifest.primaryFramework === 'nextjs' && usage.isClientFile
            ? 'process.env.NEXT_PUBLIC_API_URL'
            : manifest.primaryFramework === 'react-vite' && usage.isClientFile
              ? 'import.meta.env.VITE_API_URL'
              : 'process.env.API_BASE_URL';

        const escapedUrl = usage.urlOrHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(['"\`])${escapedUrl}\\1`);
        if (
          pattern.test(state.current) &&
          !state.current.includes(`${envExpr} || '${usage.urlOrHost}'`)
        ) {
          const prevContent = state.current;
          const updated = replaceOnTargetLine(
            state.current,
            finding.line,
            pattern,
            `(${envExpr} || '${usage.urlOrHost}')`,
          );
          if (updated !== prevContent) {
            state.current = updated;
            patches.push({
              id: `patch-${finding.ruleId}-${finding.file}-${finding.line ?? 1}`,
              ruleId: finding.ruleId,
              title: finding.fix.description,
              targetFile: finding.file,
              safety: finding.fix.safety,
              isNewFile: state.isNew,
              originalContent: prevContent,
              originalSha256: computeContentSha256(prevContent),
              proposedContent: updated,
              unifiedDiff: createUnifiedDiff(finding.file, prevContent, updated),
            });
          }
        }
      }
      continue;
    }

    // 4. DRC005: Fix hardcoded port or loopback host binding in listen()
    if (finding.ruleId === 'DRC005' && finding.file) {
      const state = getFileState(finding.file);
      const call = manifest.listenCalls.find(
        (c) => c.file === finding.file && c.line === finding.line,
      );
      if (call) {
        let updated = state.current;
        const portVal = call.hardcodedPort ?? 3000;
        if (call.hostAddress === '127.0.0.1' || call.hostAddress === 'localhost') {
          updated = updated.replace(
            new RegExp(`\\.listen\\(\\s*([^,]+)\\s*,\\s*['"]${call.hostAddress}['"]`),
            `.listen(Number(process.env.PORT || ${portVal}), '0.0.0.0'`,
          );
        } else if (call.hardcodedPort !== undefined) {
          updated = updated.replace(
            new RegExp(`\\.listen\\(\\s*${call.hardcodedPort}\\b`),
            `.listen(process.env.PORT || ${call.hardcodedPort}`,
          );
          // Also check const PORT = 3000; pattern
          if (updated === state.current) {
            updated = updated.replace(
              new RegExp(`(const|let|var)\\s+(port|PORT)\\s*=\\s*${call.hardcodedPort}\\b`),
              `$1 $2 = process.env.PORT || ${call.hardcodedPort}`,
            );
          }
        }

        if (updated !== state.current) {
          const prevContent = state.current;
          state.current = updated;
          patches.push({
            id: `patch-${finding.ruleId}-${finding.file}-${finding.line ?? 1}`,
            ruleId: finding.ruleId,
            title: finding.fix.description,
            targetFile: finding.file,
            safety: finding.fix.safety,
            isNewFile: state.isNew,
            originalContent: prevContent,
            originalSha256: computeContentSha256(prevContent),
            proposedContent: updated,
            unifiedDiff: createUnifiedDiff(finding.file, prevContent, updated),
          });
        }
      }
      continue;
    }

    // 5. DRC007: Prefix client environment variable with NEXT_PUBLIC_ or VITE_
    if (finding.ruleId === 'DRC007' && finding.file) {
      const state = getFileState(finding.file);
      const usage = manifest.envUsages.find(
        (u) => u.file === finding.file && u.line === finding.line,
      );
      if (usage) {
        const isVite =
          manifest.primaryFramework === 'react-vite' ||
          manifest.services.some(
            (s) =>
              s.framework === 'react-vite' &&
              (s.relativePath === '.' || usage.file.startsWith(`${s.relativePath}/`)),
          );
        const cleanBase = usage.name.replace(/^(REACT_APP_|NEXT_PUBLIC_|VITE_)/, '');
        const newVar = isVite ? `VITE_${cleanBase}` : `NEXT_PUBLIC_${cleanBase}`;
        const prevContent = state.current;
        const updated = prevContent
          .replace(
            `process.env.${usage.name}`,
            isVite ? `import.meta.env.${newVar}` : `process.env.${newVar}`,
          )
          .replace(`import.meta.env.${usage.name}`, `import.meta.env.${newVar}`);

        if (updated !== prevContent) {
          state.current = updated;
          patches.push({
            id: `patch-${finding.ruleId}-${finding.file}-${finding.line ?? 1}`,
            ruleId: finding.ruleId,
            title: finding.fix.description,
            targetFile: finding.file,
            safety: finding.fix.safety,
            isNewFile: state.isNew,
            originalContent: prevContent,
            originalSha256: computeContentSha256(prevContent),
            proposedContent: updated,
            unifiedDiff: createUnifiedDiff(finding.file, prevContent, updated),
          });
        }
      }
      continue;
    }

    // 6. DRC008: Update hardcoded localhost CORS origin
    if (finding.ruleId === 'DRC008' && finding.file) {
      const state = getFileState(finding.file);
      const cors = manifest.corsUsages.find(
        (c) => c.file === finding.file && c.line === finding.line,
      );
      if (cors) {
        const prevContent = state.current;
        const updated = cors.usesWildcardWithCredentials
          ? prevContent.replace(
              new RegExp(
                `origin\\s*:\\s*${cors.originValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
              ),
              `origin: process.env.CORS_ORIGIN || 'http://localhost:3000'`,
            )
          : prevContent.replace(
              new RegExp(
                `origin\\s*:\\s*${cors.originValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
              ),
              `origin: process.env.CORS_ORIGIN || ${cors.originValue}`,
            );

        if (updated !== prevContent) {
          state.current = updated;
          patches.push({
            id: `patch-${finding.ruleId}-${finding.file}-${finding.line ?? 1}`,
            ruleId: finding.ruleId,
            title: finding.fix.description,
            targetFile: finding.file,
            safety: finding.fix.safety,
            isNewFile: state.isNew,
            originalContent: prevContent,
            originalSha256: computeContentSha256(prevContent),
            proposedContent: updated,
            unifiedDiff: createUnifiedDiff(finding.file, prevContent, updated),
          });
        }
      }
      continue;
    }

    // 7. DRC012: Fix conflicting `builds` in vercel.json or empty startCommand in railway.json
    if (finding.ruleId === 'DRC012' && finding.file) {
      const state = getFileState(finding.file);
      try {
        const parsed = JSON.parse(state.current) as Record<string, unknown>;
        if (finding.file.endsWith('vercel.json') && 'builds' in parsed && 'functions' in parsed) {
          delete parsed.builds;
        } else if (
          finding.file.endsWith('railway.json') &&
          typeof parsed.deploy === 'object' &&
          parsed.deploy !== null
        ) {
          const deployObj = parsed.deploy as Record<string, unknown>;
          if (typeof deployObj.startCommand === 'string' && deployObj.startCommand.trim() === '') {
            deployObj.startCommand = 'npm run start';
          }
        }
        const updated = `${JSON.stringify(parsed, null, 2)}\n`;
        if (updated !== state.current) {
          const prevContent = state.current;
          state.current = updated;
          patches.push({
            id: `patch-${finding.ruleId}-${finding.file}`,
            ruleId: finding.ruleId,
            title: finding.fix.description,
            targetFile: finding.file,
            safety: finding.fix.safety,
            isNewFile: state.isNew,
            originalContent: prevContent,
            originalSha256: computeContentSha256(prevContent),
            proposedContent: updated,
            unifiedDiff: createUnifiedDiff(finding.file, prevContent, updated),
          });
        }
      } catch {
        manualSteps.push({
          ruleId: finding.ruleId,
          title: finding.title,
          file: finding.file,
          instructions: finding.suggestedFix,
        });
      }
    }
  }

  return { patches, manualSteps };
}
