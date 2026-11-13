import { Finding, PlatformId, RuleDefinition, sortFindingsDeterministically } from './finding';
import { ProjectManifest } from './project-manifest';
import { PlatformAdapter } from '../platforms/adapter';
import { getPlatformAdapter } from '../platforms/railway';

export interface RuleEvaluationContext {
  manifest: ProjectManifest;
  platform: PlatformId;
  adapter: PlatformAdapter;
}

export interface DeploymentRule {
  definition: RuleDefinition;
  evaluate(ctx: RuleEvaluationContext): Finding[];
}

export class RuleEngine {
  private readonly rules: DeploymentRule[];

  constructor(rules: DeploymentRule[]) {
    this.rules = rules;
  }

  evaluateProject(manifest: ProjectManifest, platform: PlatformId): Finding[] {
    const adapter = getPlatformAdapter(platform);
    const ctx: RuleEvaluationContext = {
      manifest,
      platform,
      adapter,
    };

    const allFindings: Finding[] = [];
    for (const rule of this.rules) {
      if (!rule.definition.platforms.includes(platform)) {
        continue;
      }
      const findings = rule.evaluate(ctx);
      allFindings.push(...findings);
    }

    return sortFindingsDeterministically(allFindings);
  }
}
