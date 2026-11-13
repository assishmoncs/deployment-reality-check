import { FrameworkType, ProjectManifest } from '../core/project-manifest';
import { PlatformAdapter, PlatformCapabilitySpec } from './adapter';

export const VERCEL_CAPABILITIES: PlatformCapabilitySpec = {
  id: 'vercel',
  displayName: 'Vercel',
  executionModel: 'serverless-ephemeral',
  hasPersistentLocalFilesystemByDefault: false,
  supportsAttachedVolumes: false,
  supportsLongRunningProcesses: false,
  supportsStatefulWebSockets: false,
  requiresDynamicPortBinding: false,
  requiresZeroHostBinding: false,
  limitsSummary: {
    functionDurationNote:
      'Plan- and runtime-dependent: Hobby default/max 300s; Pro/Enterprise default 300s, configurable up to 800s (up to 1800s in beta with Fluid Compute). Edge Runtime must begin sending a response within 25s (streaming up to 300s).',
    bundleSizeNote:
      '250 MB uncompressed for Node.js runtime functions (500 MB for Python; up to 5 GB in beta with Large Functions & Fluid Compute).',
    memoryNote: 'Hobby: up to 2 GB / 1 vCPU; Pro & Enterprise: up to 4 GB / 2 vCPUs.',
    filesystemNote:
      'Read-only deployment bundle except ephemeral /tmp directory, which is wiped between function cold starts and is never shared across instances.',
  },
  officialDocs: {
    overview: 'https://vercel.com/docs',
    limits: 'https://vercel.com/docs/functions/limitations',
    environmentVariables: 'https://vercel.com/docs/projects/environment-variables',
    storage: 'https://vercel.com/docs/storage',
    configuration: 'https://vercel.com/docs/project-configuration',
  },
  lastReviewedDate: '2026-09-16',
};

export class VercelPlatformAdapter implements PlatformAdapter {
  readonly id = 'vercel' as const;
  readonly capabilities = VERCEL_CAPABILITIES;

  isRecommendedForFramework(framework: FrameworkType): boolean {
    return framework === 'nextjs' || framework === 'react-vite';
  }

  hasExplicitVolumeConfigured(_manifest: ProjectManifest): boolean {
    return false;
  }
}
