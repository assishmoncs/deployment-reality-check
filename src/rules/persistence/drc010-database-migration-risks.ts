import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc010DatabaseMigrationRisksRule: DeploymentRule = {
  definition: {
    id: 'DRC010',
    name: 'Database migration or initialization risks',
    category: 'persistence',
    defaultSeverity: 'warning',
    defaultConfidence: 'medium',
    platforms: ['vercel', 'railway'],
    autofixEligible: false,
    fixSafety: 'manual-guided',
    summary: 'Project uses a database ORM without production build/migration hooks or executes destructive schema resets at startup.',
    whatItMeans:
      'Your application uses Prisma or another schema migration tool without `prisma generate` / migration deployment steps, or runs destructive commands (`migrate reset`, `--force-reset`, `DROP TABLE`) during startup.',
    whyItHappens:
      'Locally, developers run migrations manually or use destructive reset scripts to re-seed test data. In CI/CD or container startups, missing client generation causes runtime crashes, while destructive startup commands wipe production data.',
    deploymentImpact:
      'Destructive commands in build/start scripts will permanently erase production tables on redeploy. Missing `prisma generate` causes @prisma/client initialization errors in production builds.',
    whenItApplies:
      'Applies when destructive database reset commands appear in startup/build paths (Critical) or when Prisma is used without a generate/migrate script in package.json (Warning).',
    howToResolve:
      'Remove `--force-reset`, `migrate reset`, and `DROP TABLE` from startup scripts. Use `prisma generate` during build and `prisma migrate deploy` in your release/deploy workflow.',
    PlatformNotes: {
      vercel: 'Run `prisma generate && next build` in your build command so the Prisma Client matches the Vercel Linux runtime.',
      railway: 'Use `npx prisma migrate deploy` in a deploy command or pre-start script, never `migrate reset`.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/storage',
      railway: 'https://docs.railway.com/databases/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];
    const db = manifest.databaseFacts;

    if (db.hasDestructiveDropOrResetInStart) {
      findings.push({
        ruleId: 'DRC010',
        title: 'Destructive database reset or DROP TABLE in startup/build path',
        severity: 'critical',
        confidence: 'high',
        platform,
        category: 'persistence',
        message: `Destructive database operation (${db.destructiveScriptEvidence ?? 'schema reset'}) detected in ${db.destructiveScriptFile ?? 'project startup'}. This can wipe production data on deploy.`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `${db.destructiveScriptEvidence ?? 'Destructive SQL/migration reset'} in ${db.destructiveScriptFile ?? 'package.json'}`,
        file: db.destructiveScriptFile ?? 'package.json',
        line: 1,
        column: 1,
        suggestedFix:
          'Remove `migrate reset`, `--force-reset`, or `DROP TABLE` from build/start paths and use safe forward migrations (`prisma migrate deploy`).',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description: 'DRC never automatically alters database migration workflows. Manually replace destructive commands with safe forward migrations.',
        },
        docsUrl: adapter.capabilities.officialDocs.storage,
      });
    }

    if (db.hasPrisma && !db.hasMigrateOrGenerateScript) {
      const targetFile = db.prismaSchemaPath ?? 'package.json';
      findings.push({
        ruleId: 'DRC010',
        title: 'Prisma detected without client generation or migration script',
        severity: 'warning',
        confidence: 'medium',
        platform,
        category: 'persistence',
        message:
          'Prisma is used in this project, but package.json does not include `prisma generate` or `prisma migrate deploy` in build/postinstall scripts.',
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `Prisma schema/dependency present (${targetFile}) without prisma generate/migrate script in package.json`,
        file: targetFile,
        line: 1,
        column: 1,
        suggestedFix:
          'Add `"postinstall": "prisma generate"` (or prepend `prisma generate &&` to `"build"`) and run `prisma migrate deploy` during release.',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description: 'Add prisma generate to your build pipeline and configure safe migration deployment.',
        },
        docsUrl: adapter.capabilities.officialDocs.storage,
      });
    }

    return findings;
  },
};
