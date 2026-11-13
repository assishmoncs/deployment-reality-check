import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc009LocalFileUploadsRule: DeploymentRule = {
  definition: {
    id: 'DRC009',
    name: 'Non-persistent local file upload storage',
    category: 'persistence',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: false,
    fixSafety: 'manual-guided',
    summary:
      'Application saves user-uploaded files to the local container or serverless filesystem.',
    whatItMeans:
      'Your code stores uploaded files on local disk (using multer diskStorage, upload directories, or fs.writeFile to ./uploads or ./public/uploads).',
    whyItHappens:
      'Saving uploads to a local ./uploads folder works on a developer workstation where the hard drive persists indefinitely.',
    deploymentImpact:
      'On Vercel, writing outside /tmp throws an EROFS (read-only filesystem) error, and /tmp files disappear after the function finishes. On Railway, local container directories are wiped on every deployment or restart unless backed by an attached Volume.',
    whenItApplies:
      'Applies when non-test code configures multer local disk storage or writes uploaded media to local disk directories.',
    howToResolve:
      'Store user uploads in object storage such as AWS S3, Cloudflare R2, Supabase Storage, or Vercel Blob (or attach a Railway Volume for single-container persistence).',
    PlatformNotes: {
      vercel:
        'Use Vercel Blob, AWS S3, Cloudflare R2, or Supabase Storage with direct client uploads.',
      railway: 'Use S3-compatible object storage (or attach a Railway Volume to the upload path).',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/storage/vercel-blob',
      railway: 'https://docs.railway.com/databases/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    if (platform === 'railway' && adapter.hasExplicitVolumeConfigured(manifest)) {
      return [];
    }

    for (const upload of manifest.fileUploads) {
      if (upload.isTestFile) continue;

      const isVercel = platform === 'vercel';
      const severity = isVercel && !upload.isTempDir ? 'critical' : 'warning';

      findings.push({
        ruleId: 'DRC009',
        title: 'Non-persistent local file upload storage',
        severity,
        confidence: 'high',
        platform,
        category: 'persistence',
        message: isVercel
          ? `File upload handler (${upload.library}) in ${upload.file}:${upload.line} writes to ${upload.destinationPath ?? 'local disk'}. Vercel Functions have a read-only filesystem (except ephemeral /tmp).`
          : `File upload handler (${upload.library}) in ${upload.file}:${upload.line} saves files to ${upload.destinationPath ?? 'local disk'} without a persistent Volume. Uploaded files will be lost on every redeploy.`,
        whyItHappens: this.definition.whyItHappens,
        deploymentImpact: this.definition.deploymentImpact,
        evidence: `${upload.library} targeting ${upload.destinationPath ?? 'local disk'} in ${upload.file}:${upload.line}`,
        file: upload.file,
        line: upload.line,
        column: upload.column,
        suggestedFix:
          'Store uploaded files in S3, Cloudflare R2, Supabase Storage, or Vercel Blob instead of the local filesystem.',
        fix: {
          eligible: false,
          safety: 'manual-guided',
          description:
            'Switch from local disk storage to cloud object storage (S3 / R2 / Supabase Storage / Vercel Blob).',
        },
        docsUrl: adapter.capabilities.officialDocs.storage,
      });
    }

    return findings;
  },
};
