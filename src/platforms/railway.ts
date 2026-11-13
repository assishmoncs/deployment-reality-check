import { VercelPlatformAdapter } from "./vercel";
import { FrameworkType, ProjectManifest } from '../core/project-manifest';
import { PlatformAdapter, PlatformCapabilitySpec } from './adapter';

export const RAILWAY_CAPABILITIES: PlatformCapabilitySpec = {
  id: 'railway',
  displayName: 'Railway',
  executionModel: 'container-service',
  hasPersistentLocalFilesystemByDefault: false,
  supportsAttachedVolumes: true,
  supportsLongRunningProcesses: true,
  supportsStatefulWebSockets: true,
  requiresDynamicPortBinding: true,
  requiresZeroHostBinding: true,
  limitsSummary: {
    functionDurationNote:
      'No per-request invocation timeout for persistent container services; old deployments receive SIGTERM on redeploy (configurable via RAILWAY_DEPLOYMENT_DRAINING_SECONDS).',
    bundleSizeNote: 'Container image build with Nixpacks or Dockerfile; no 250 MB serverless bundle cap.',
    memoryNote: 'Plan-dependent container resources (Hobby / Pro scaling vCPU and RAM per service).',
    filesystemNote:
      'Container filesystem is ephemeral across deployments and restarts unless a Railway Volume is explicitly attached (indicated via RAILWAY_VOLUME_MOUNT_PATH).',
  },
  officialDocs: {
    overview: 'https://docs.railway.com',
    limits: 'https://docs.railway.com/deployments/reference',
    environmentVariables: 'https://docs.railway.com/variables/reference',
    storage: 'https://docs.railway.com/databases/reference',
    configuration: 'https://docs.railway.com/reference/config-as-code',
  },
  lastReviewedDate: '2026-09-16',
};

export class RailwayPlatformAdapter implements PlatformAdapter {
  readonly id = 'railway' as const;
  readonly capabilities = RAILWAY_CAPABILITIES;

  isRecommendedForFramework(framework: FrameworkType): boolean {
    return framework === 'express' || framework === 'nextjs' || framework === 'react-vite';
  }

  hasExplicitVolumeConfigured(manifest: ProjectManifest): boolean {
    const usesVolumeEnv = manifest.envUsages.some(
      (u) => u.name === 'RAILWAY_VOLUME_MOUNT_PATH' || u.name === 'RAILWAY_VOLUME_NAME',
    );
    const definedVolumeEnv =
      manifest.envFacts.definedInEnvExample.has('RAILWAY_VOLUME_MOUNT_PATH') ||
      manifest.envFacts.definedInEnvFiles.has('RAILWAY_VOLUME_MOUNT_PATH');
    return usesVolumeEnv || definedVolumeEnv;
  }
}

export function getPlatformAdapter(platform: 'vercel' | 'railway'): PlatformAdapter {
  return platform === 'vercel' ? new VercelPlatformAdapter() : new RailwayPlatformAdapter();
}
