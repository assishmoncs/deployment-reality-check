import { PlatformId } from '../core/finding';
import { FrameworkType, ProjectManifest } from '../core/project-manifest';

export interface PlatformCapabilitySpec {
  id: PlatformId;
  displayName: string;
  executionModel: 'serverless-ephemeral' | 'container-service';
  hasPersistentLocalFilesystemByDefault: boolean;
  supportsAttachedVolumes: boolean;
  supportsLongRunningProcesses: boolean;
  supportsStatefulWebSockets: boolean;
  requiresDynamicPortBinding: boolean;
  requiresZeroHostBinding: boolean;
  limitsSummary: {
    functionDurationNote: string;
    bundleSizeNote: string;
    memoryNote: string;
    filesystemNote: string;
  };
  officialDocs: {
    overview: string;
    limits: string;
    environmentVariables: string;
    storage: string;
    configuration: string;
  };
  lastReviewedDate: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly capabilities: PlatformCapabilitySpec;
  isRecommendedForFramework(framework: FrameworkType): boolean;
  hasExplicitVolumeConfigured(manifest: ProjectManifest): boolean;
}

/**
 * Future-ready extension point for additional framework detectors (e.g., FastAPI, Flask)
 * and additional deployment targets (e.g., Render, Fly.io) in future releases.
 */
export interface FuturePlatformExtensionPoint {
  registerPlatformAdapter(adapter: PlatformAdapter): void;
}
