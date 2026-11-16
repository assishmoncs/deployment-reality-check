import * as readline from 'readline';
import { PlatformId } from '../core/finding';

export const PLATFORM_SELECTION_REQUIRED =
  'Error: Deployment platform is ambiguous or unknown. Use --platform vercel or --platform railway.';

export interface PromptAdapter {
  selectPlatform(): Promise<PlatformId>;
  confirmAction(message: string, defaultYes?: boolean): Promise<boolean>;
}

export function isInteractiveTerminal(nonInteractiveFlag = false): boolean {
  if (nonInteractiveFlag) return false;
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return Boolean(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
}

export class TerminalPromptAdapter implements PromptAdapter {
  async selectPlatform(): Promise<PlatformId> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise<PlatformId>((resolve) => {
      rl.question(
        'Select deployment target platform [1 = vercel, 2 = railway] (default: vercel): ',
        (answer) => {
          rl.close();
          const trimmed = answer.trim().toLowerCase();
          if (trimmed === '2' || trimmed === 'railway') {
            resolve('railway');
          } else {
            resolve('vercel');
          }
        },
      );
    });
  }

  async confirmAction(message: string, defaultYes = false): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    return new Promise<boolean>((resolve) => {
      rl.question(`${message} ${suffix}: `, (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        if (!trimmed) {
          resolve(defaultYes);
          return;
        }
        resolve(trimmed === 'y' || trimmed === 'yes');
      });
    });
  }
}

export function resolveTargetPlatform(params: {
  explicitPlatform?: string;
  inferredPlatforms: PlatformId[];
  primaryFramework: string;
  detectedFrameworks?: string[];
}): PlatformId | null {
  if (params.explicitPlatform) {
    const norm = params.explicitPlatform.trim().toLowerCase();
    if (norm === 'vercel' || norm === 'railway') {
      return norm;
    }
    throw new Error(
      `Unsupported deployment platform '${params.explicitPlatform}'. Supported platforms in v1.0.0: vercel, railway.`,
    );
  }

  if (params.inferredPlatforms.length > 1) return null;
  if (params.inferredPlatforms.length === 1) {
    return params.inferredPlatforms[0]!;
  }

  const frameworks = params.detectedFrameworks ?? [];
  if (
    frameworks.includes('express') &&
    frameworks.some((framework) => framework === 'nextjs' || framework === 'react-vite')
  )
    return null;

  if (params.primaryFramework === 'nextjs' || params.primaryFramework === 'react-vite') {
    return 'vercel';
  }
  if (params.primaryFramework === 'express') {
    return 'railway';
  }

  return null;
}
