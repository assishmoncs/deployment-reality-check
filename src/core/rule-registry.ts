import { RuleDefinition } from './finding';
import { DeploymentRule } from './rule-engine';
import { drc001MissingEnvConfigRule } from '../rules/environment/drc001-missing-env-config';
import { drc002HardcodedLocalhostRule } from '../rules/networking/drc002-hardcoded-localhost';
import { drc003SqlitePersistenceRule } from '../rules/persistence/drc003-sqlite-persistence';
import { drc004BuildStartScriptsRule } from '../rules/runtime/drc004-build-start-scripts';
import { drc005PortHostBindingRule } from '../rules/networking/drc005-port-host-binding';
import { drc006ExposedFrontendSecretsRule } from '../rules/security/drc006-exposed-Frontend-secrets';
import { drc007FrontendApiUrlRule } from '../rules/environment/drc007-frontend-api-url';
import { drc008CorsMismatchRule } from '../rules/networking/drc008-cors-mismatch';
import { drc009LocalFileUploadsRule } from '../rules/persistence/drc009-local-file-uploads';
import { drc010DatabaseMigrationRisksRule } from '../rules/persistence/drc010-database-migration-risks';
import { drc011LongRunningProcessesRule } from '../rules/runtime/drc011-long-running-processes';
import { drc012DeploymentConfigRule } from '../rules/runtime/drc012-deployment-config';

export const BUILTIN_RULES: DeploymentRule[] = [
  drc001MissingEnvConfigRule,
  drc002HardcodedLocalhostRule,
  drc003SqlitePersistenceRule,
  drc004BuildStartScriptsRule,
  drc005PortHostBindingRule,
  drc006ExposedFrontendSecretsRule,
  drc007FrontendApiUrlRule,
  drc008CorsMismatchRule,
  drc009LocalFileUploadsRule,
  drc010DatabaseMigrationRisksRule,
  drc011LongRunningProcessesRule,
  drc012DeploymentConfigRule,
];

export function getAllRules(): DeploymentRule[] {
  return [...BUILTIN_RULES];
}

export function getRuleById(ruleId: string): DeploymentRule | undefined {
  const normalized = ruleId.trim().toUpperCase();
  return BUILTIN_RULES.find((r) => r.definition.id === normalized);
}

export function getAllRuleDefinitions(): RuleDefinition[] {
  return BUILTIN_RULES.map((r) => r.definition);
}
