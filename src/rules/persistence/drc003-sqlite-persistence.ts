import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc003SqlitePersistenceRule: DeploymentRule = {
  definition: {
    id: 'DRC003',
    name: 'Non-persistent SQLite database or file storage',
    category: 'persistence',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: false,
    fixSafety: 'manual-guided',
    summary: 'Application uses a file-based SQLite database on an ephemeral filesystem.',
    whatItMeans:
      'Your application uses a local SQLite database file (such as sqlite3, better-sqlite3, or Prisma with provider = "sqlite").',
    whyItHappens:
      'SQLite stores data in a regular file on disk. While convenient locally, serverless functions and default cloud containers use ephemeral filesystems that reset on every deploy or scale event.',
    deploymentImpact:
      'On Vercel, the filesystem is read-only (except ephemeral /tmp), causing writes to fail or vanish across requests. On Railway, container storage is wiped on every redeploy unless a persistent Volume is attached.',
    whenItApplies:
      'Applies as Critical when SQLite file storage is actively initialized in code or Prisma schema on Vercel, or as Warning on Railway when no persistent volume is configured. Dependency-only presence without active file writes is downgraded to Warning/Info.',
    howToResolve:
      'Migrate persistent data to a managed cloud database (PostgreSQL, Neon, Supabase, Turso/libSQL) or attach a persistent Railway Volume (RAILWAY_VOLUME_MOUNT_PATH) for single-instance services.',
    PlatformNotes: {
      vercel:
        'Vercel Functions cannot persist local SQLite files across invocations. Use Vercel Postgres / Neon, Supabase, or Turso (HTTP-based SQLite).',
      railway:
        'Either provision a Railway PostgreSQL service or attach a persistent Railway Volume to the container path where the SQLite file is stored.',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/storage',
      railway: 'https://docs.railway.com/databases/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const nonTestUsages = manifest.sqliteUsages.filter((u) => !u.isTestFile && !u.isInMemory);
    if (nonTestUsages.length === 0) return [];

    // Separate active code/schema usages from package.json-only dependency declarations
    const activeCodeUsages = nonTestUsages.filter((u) => !u.file.endsWith('package.json'));
    const pkgOnlyUsages = nonTestUsages.filter((u) => u.file.endsWith('package.json'));

    if (platform === 'railway' && adapter.hasExplicitVolumeConfigured(manifest)) {
      return [];
    }

    if (activeCodeUsages.length > 0) {
      const primary = activeCodeUsages[0]!;
      const isVercel = platform === 'vercel';
      return [
        {
          ruleId: 'DRC003',
          title: 'Local database persistence risk',
          severity: isVercel ? 'critical' : 'warning',
          confidence: 'high',
          platform,
          category: 'persistence',
          message: isVercel
            ? 'Your application writes data to a local SQLite database, but this deployment environment does not provide persistent writable application storage.'
            : 'Your application writes to a local SQLite file on Railway without an attached persistent Volume configuration (RAILWAY_VOLUME_MOUNT_PATH). Data will be lost on redeploy.',
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `SQLite usage (${primary.driverOrPattern}) detected in ${primary.file}:${primary.line}`,
          file: primary.file,
          line: primary.line,
          column: primary.column,
          suggestedFix: isVercel
            ? 'Move persistent application data to a hosted database (e.g., PostgreSQL, Supabase, or Turso).'
            : 'Move persistent data to Railway PostgreSQL or attach a persistent Railway Volume and store the SQLite file inside RAILWAY_VOLUME_MOUNT_PATH.',
          fix: {
            eligible: false,
            safety: 'manual-guided',
            description:
              'Guided remediation: Configure a hosted database URL (e.g. DATABASE_URL) or attach a persistent volume rather than auto-mutating database schemas.',
          },
          docsUrl: adapter.capabilities.officialDocs.storage,
        },
      ];
    }

    // Only package.json dependency found without active file path in source
    const depUsage = pkgOnlyUsages[0]!;
    return [
      {
        ruleId: 'DRC003',
        title: 'SQLite dependency detected in package.json',
        severity: 'info',
        confidence: 'medium',
        platform,
        category: 'persistence',
        message: `Package dependency '${depUsage.driverOrPattern}' is installed. Verify it is not used for persistent production storage without an external database or persistent volume.`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `Dependency "${depUsage.driverOrPattern}" in ${depUsage.file}`,
        file: depUsage.file,
        line: depUsage.line,
        column: depUsage.column,
        suggestedFix:
          'If SQLite is only used for local tests, move it to devDependencies; otherwise use a hosted database in production.',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description: 'Review SQLite dependency usage in production.',
        },
        docsUrl: adapter.capabilities.officialDocs.storage,
      },
    ];
  },
};
