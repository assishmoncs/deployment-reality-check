import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc012DeploymentConfigRule: DeploymentRule = {
  definition: {
    id: 'DRC012',
    name: 'Conflicting or invalid deployment configuration',
    category: 'runtime',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'approval-required',
    summary:
      'Deployment configuration files (vercel.json, railway.json, railway.toml) contain syntax errors, deprecated conflicting keys, or broken command references.',
    whatItMeans:
      'Your project contains a platform configuration file that is malformed JSON/TOML, combines mutually exclusive properties (such as `builds` and `functions` in vercel.json), or has an invalid build/start command value.',
    whyItHappens:
      'Hand-editing vercel.json or railway.json, or copying outdated configuration snippets from older platform versions, often introduces conflicting fields or syntax mistakes.',
    deploymentImpact:
      'The deployment platform will immediately reject the deployment during configuration validation before your build even starts.',
    whenItApplies:
      'Applies when vercel.json, railway.json, or railway.toml fails syntax parsing, uses conflicting properties, or specifies invalid cron/function settings.',
    howToResolve:
      'Fix JSON/TOML syntax errors, remove legacy `builds` when using `functions` in vercel.json, and set configured commands to valid strings.',
    PlatformNotes: {
      vercel:
        'In vercel.json, `builds` is a legacy property and cannot be combined with `functions`. Cron schedules must have 5 fields and paths must start with `/`.',
      railway:
        'In railway.json / railway.toml, ensure `deploy.startCommand` and `build.buildCommand` are valid strings.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/project-configuration',
      railway: 'https://docs.railway.com/reference/config-as-code',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];
    const cfg = manifest.configFacts;

    // 1. Check JSON/TOML parse errors in deployment configs
    if (platform === 'vercel' && cfg.vercelJsonParseError && cfg.vercelJsonPath) {
      findings.push({
        ruleId: 'DRC012',
        title: 'Malformed vercel.json configuration file',
        severity: 'critical',
        confidence: 'high',
        platform,
        category: 'runtime',
        message: `Configuration file ${cfg.vercelJsonPath} contains invalid JSON: ${cfg.vercelJsonParseError}`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `${cfg.vercelJsonPath}: ${cfg.vercelJsonParseError}`,
        file: cfg.vercelJsonPath,
        line: 1,
        column: 1,
        suggestedFix: 'Fix the JSON syntax error in vercel.json.',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description: 'Repair malformed JSON syntax in vercel.json.',
        },
        docsUrl: 'https://vercel.com/docs/project-configuration',
      });
    }

    if (platform === 'railway' && cfg.railwayJsonParseError && cfg.railwayJsonPath) {
      findings.push({
        ruleId: 'DRC012',
        title: 'Malformed railway.json configuration file',
        severity: 'critical',
        confidence: 'high',
        platform,
        category: 'runtime',
        message: `Configuration file ${cfg.railwayJsonPath} contains invalid JSON: ${cfg.railwayJsonParseError}`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `${cfg.railwayJsonPath}: ${cfg.railwayJsonParseError}`,
        file: cfg.railwayJsonPath,
        line: 1,
        column: 1,
        suggestedFix: 'Fix the JSON syntax error in railway.json.',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description: 'Repair malformed JSON syntax in railway.json.',
        },
        docsUrl: 'https://docs.railway.com/reference/config-as-code',
      });
    }

    if (platform === 'railway' && cfg.railwayTomlParseError && cfg.railwayTomlPath) {
      findings.push({
        ruleId: 'DRC012',
        title: 'Malformed railway.toml configuration file',
        severity: 'critical',
        confidence: 'high',
        platform,
        category: 'runtime',
        message: `Configuration file ${cfg.railwayTomlPath} contains invalid TOML: ${cfg.railwayTomlParseError}`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `${cfg.railwayTomlPath}: ${cfg.railwayTomlParseError}`,
        file: cfg.railwayTomlPath,
        line: 1,
        column: 1,
        suggestedFix: 'Fix the TOML syntax error in railway.toml.',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description: 'Repair malformed TOML syntax in railway.toml.',
        },
        docsUrl: 'https://docs.railway.com/reference/config-as-code',
      });
    }

    // 2. Semantic validation of vercel.json
    if (platform === 'vercel' && cfg.vercelJsonRaw && cfg.vercelJsonPath) {
      const vRaw = cfg.vercelJsonRaw;
      if ('builds' in vRaw && 'functions' in vRaw) {
        findings.push({
          ruleId: 'DRC012',
          title: 'Conflicting `builds` and `functions` properties in vercel.json',
          severity: 'critical',
          confidence: 'high',
          platform,
          category: 'runtime',
          message: `${cfg.vercelJsonPath} defines both legacy \`builds\` and modern \`functions\`. Vercel rejects configurations that combine both properties.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `Both "builds" and "functions" present in ${cfg.vercelJsonPath}`,
          file: cfg.vercelJsonPath,
          line: 1,
          column: 1,
          suggestedFix:
            'Remove the legacy `"builds"` property from vercel.json and use `"functions"` exclusively.',
          fix: {
            eligible: true,
            safety: 'approval-required',
            description: `Remove legacy "builds" key from ${cfg.vercelJsonPath}`,
          },
          docsUrl: 'https://vercel.com/docs/project-configuration',
        });
      }

      if (Array.isArray(vRaw.crons)) {
        for (const cronItem of vRaw.crons) {
          if (typeof cronItem === 'object' && cronItem !== null) {
            const cObj = cronItem as Record<string, unknown>;
            const cPath = typeof cObj.path === 'string' ? cObj.path : '';
            const cSched = typeof cObj.schedule === 'string' ? cObj.schedule : '';
            if (!cPath.startsWith('/') || cSched.trim().split(/\s+/).length !== 5) {
              findings.push({
                ruleId: 'DRC012',
                title: 'Invalid cron job entry in vercel.json',
                severity: 'critical',
                confidence: 'high',
                platform,
                category: 'runtime',
                message: `Invalid cron definition in ${cfg.vercelJsonPath} (path="${cPath}", schedule="${cSched}"). Cron paths must start with '/' and schedules must have 5 cron fields.`,
                whyItHappens: this.definition.whyItHappens,
                deploymentImpact: this.definition.deploymentImpact,
                evidence: `Invalid cron entry ${JSON.stringify(cronItem)} in ${cfg.vercelJsonPath}`,
                file: cfg.vercelJsonPath,
                line: 1,
                column: 1,
                suggestedFix:
                  'Ensure cron `path` starts with `/` (e.g. `/api/cron`) and `schedule` is a valid 5-part cron expression.',
                fix: {
                  eligible: false,
                  safety: 'manual-guided',
                  description:
                    'Correct the cron path and 5-part schedule expression in vercel.json.',
                },
                docsUrl: 'https://vercel.com/docs/cron-jobs',
              });
            }
          }
        }
      }
    }

    if (platform === 'railway') {
      for (const [file, config] of [
        [cfg.railwayJsonPath, cfg.railwayJsonRaw],
        [cfg.railwayTomlPath, cfg.railwayTomlRaw],
      ] as const) {
        if (!file || !config) continue;
        for (const [section, key] of [
          ['build', 'buildCommand'],
          ['deploy', 'startCommand'],
        ] as const) {
          const settings = config[section];
          if (settings === undefined) continue;
          const validSection =
            settings !== null && typeof settings === 'object' && !Array.isArray(settings);
          const command = validSection ? (settings as Record<string, unknown>)[key] : undefined;
          if (
            validSection &&
            (command === undefined ||
              command === null ||
              (typeof command === 'string' && command.trim() !== ''))
          )
            continue;

          const field = validSection ? `${section}.${key}` : section;
          const suggestedFix = validSection
            ? `Set ${field} to a non-empty command string or remove the field to use Railway defaults.`
            : `Set ${section} to a configuration object or remove it.`;
          const autoStart =
            /(?:^|\/)railway\.json$/.test(file) &&
            typeof command === 'string' &&
            key === 'startCommand';
          findings.push({
            ruleId: 'DRC012',
            title: `Invalid ${field} in Railway configuration`,
            severity: 'critical',
            confidence: 'high',
            platform,
            category: 'runtime',
            message: `${file} has an invalid value for ${field}.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `${field} in ${file}`,
            file,
            line: 1,
            column: 1,
            suggestedFix,
            fix: {
              eligible: autoStart,
              safety: autoStart ? 'approval-required' : 'manual-guided',
              description: autoStart
                ? `Remove the empty field ${field} from ${file} to use Railway defaults.`
                : suggestedFix,
            },
            docsUrl: adapter.capabilities.officialDocs.configuration,
          });
        }
      }
    }

    return findings;
  },
};
