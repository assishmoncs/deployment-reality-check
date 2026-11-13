import * as path from 'path';
import { DeploymentConfigFacts, EnvFilesFacts } from '../core/project-manifest';
import { PlatformId } from '../core/finding';
import { readTextFileSafe } from '../utils/fs-safe';
import { validateJsonSafe } from '../utils/schema';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const YAML = require('yaml');

export function parseDotenvKeys(content: string): string[] {
  const keys: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && match[1]) {
      keys.push(match[1]);
    }
  }
  return keys;
}

export function parseSimpleToml(content: string): {
  data?: Record<string, unknown>;
  error?: string;
} {
  const result: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = result;
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    if (line.startsWith('[')) {
      if (!line.endsWith(']')) {
        return { error: `Invalid TOML section header at line ${i + 1}: ${rawLine}` };
      }
      const sectionName = line.slice(1, -1).trim();
      if (!sectionName) {
        return { error: `Empty TOML section header at line ${i + 1}` };
      }
      const parts = sectionName.split('.');
      let cursor = result;
      for (const part of parts) {
        if (typeof cursor[part] !== 'object' || cursor[part] === null) {
          cursor[part] = {};
        }
        cursor = cursor[part] as Record<string, unknown>;
      }
      currentSection = cursor;
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      return { error: `Invalid TOML key-value assignment at line ${i + 1}: ${rawLine}` };
    }
    const key = line.slice(0, eqIdx).trim();
    let valRaw = line.slice(eqIdx + 1).trim();
    if (!key) {
      return { error: `Empty TOML key at line ${i + 1}` };
    }
    if (
      (valRaw.startsWith('"') && valRaw.endsWith('"')) ||
      (valRaw.startsWith("'") && valRaw.endsWith("'"))
    ) {
      valRaw = valRaw.slice(1, -1);
      currentSection[key] = valRaw;
    } else if (valRaw === 'true' || valRaw === 'false') {
      currentSection[key] = valRaw === 'true';
    } else if (!Number.isNaN(Number(valRaw))) {
      currentSection[key] = Number(valRaw);
    } else {
      currentSection[key] = valRaw;
    }
  }

  return { data: result };
}

export function discoverDeploymentConfigs(
  rootDir: string,
  allFiles: string[],
): {
  configFacts: DeploymentConfigFacts;
  envFacts: EnvFilesFacts;
  inferredPlatforms: PlatformId[];
  parseErrors: Array<{ file: string; error: string }>;
} {
  const configFacts: DeploymentConfigFacts = {};
  const parseErrors: Array<{ file: string; error: string }> = [];
  const inferredPlatforms = new Set<PlatformId>();

  const envFilesFound: string[] = [];
  const envExampleFilesFound: string[] = [];
  const definedInEnvFiles = new Set<string>();
  const definedInEnvExample = new Set<string>();

  for (const file of allFiles) {
    const base = path.posix.basename(file);

    if (
      base === '.env.example' ||
      base === '.env.sample' ||
      base === '.env.template'
    ) {
      envExampleFilesFound.push(file);
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        for (const k of parseDotenvKeys(readRes.content)) {
          definedInEnvExample.add(k);
        }
      }
    } else if (base === '.env' || base.startsWith('.env.')) {
      envFilesFound.push(file);
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        for (const k of parseDotenvKeys(readRes.content)) {
          definedInEnvFiles.add(k);
        }
      }
    }

    if (file === 'vercel.json' || file.endsWith('/vercel.json')) {
      configFacts.vercelJsonPath = file;
      inferredPlatforms.add('vercel');
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        const validated = validateJsonSafe(readRes.content, file);
        if (validated.success && validated.data) {
          configFacts.vercelJsonRaw = validated.data;
        } else {
          const errMsg = validated.issues.map((i) => i.message).join('; ');
          configFacts.vercelJsonParseError = errMsg;
          parseErrors.push({ file, error: errMsg });
        }
      }
    }

    if (file === 'railway.json' || file.endsWith('/railway.json')) {
      configFacts.railwayJsonPath = file;
      inferredPlatforms.add('railway');
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        const validated = validateJsonSafe(readRes.content, file);
        if (validated.success && validated.data) {
          configFacts.railwayJsonRaw = validated.data;
        } else {
          const errMsg = validated.issues.map((i) => i.message).join('; ');
          configFacts.railwayJsonParseError = errMsg;
          parseErrors.push({ file, error: errMsg });
        }
      }
    }

    if (file === 'railway.toml' || file.endsWith('/railway.toml')) {
      configFacts.railwayTomlPath = file;
      inferredPlatforms.add('railway');
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        const parsed = parseSimpleToml(readRes.content);
        if (parsed.data) {
          configFacts.railwayTomlRaw = parsed.data;
        } else if (parsed.error) {
          configFacts.railwayTomlParseError = parsed.error;
          parseErrors.push({ file, error: parsed.error });
        }
      }
    }

    if (base === 'Procfile') {
      configFacts.procfilePath = file;
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        configFacts.procfileContent = readRes.content;
      }
    }

    if (base === 'Dockerfile') {
      configFacts.dockerfilePath = file;
    }

    if (file === 'pnpm-workspace.yaml') {
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        try {
          const parsedYaml = YAML.parse(readRes.content) as { packages?: unknown } | null;
          if (parsedYaml && Array.isArray(parsedYaml.packages)) {
            configFacts.pnpmWorkspacePackages = parsedYaml.packages.filter(
              (p): p is string => typeof p === 'string',
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parseErrors.push({ file, error: `Invalid YAML syntax: ${msg}` });
        }
      }
    }

    if (
      base === 'next.config.js' ||
      base === 'next.config.mjs' ||
      base === 'next.config.ts'
    ) {
      configFacts.nextConfigPath = file;
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        configFacts.nextConfigContent = readRes.content;
      }
    }

    if (
      base === 'vite.config.ts' ||
      base === 'vite.config.js' ||
      base === 'vite.config.mjs'
    ) {
      configFacts.viteConfigPath = file;
      const readRes = readTextFileSafe(rootDir, file);
      if (readRes.content) {
        configFacts.viteConfigContent = readRes.content;
      }
    }
  }

  return {
    configFacts,
    envFacts: {
      envFilesFound,
      envExampleFilesFound,
      definedInEnvFiles,
      definedInEnvExample,
    },
    inferredPlatforms: Array.from(inferredPlatforms),
    parseErrors,
  };
}
