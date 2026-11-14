import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const drc004BuildStartScriptsRule: DeploymentRule = {
  definition: {
    id: 'DRC004',
    name: 'Missing or invalid production build/start scripts',
    category: 'runtime',
    defaultSeverity: 'critical',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: true,
    fixSafety: 'safe-auto',
    summary:
      'package.json is missing required production build or start scripts, or uses development-only watchers in production.',
    whatItMeans:
      'Cloud deployment platforms inspect package.json scripts ("build" and "start") to compile and launch your application in production.',
    whyItHappens:
      'Developers frequently run "npm run dev" or "nodemon" locally and forget to define a production "start" or "build" script before deploying.',
    deploymentImpact:
      'On Railway, missing "start" scripts or dev-only runners (nodemon/ts-node-dev) cause deployment crashes or high memory usage. On Vercel, missing "build" scripts prevent frontend/Next.js bundles from compiling.',
    whenItApplies:
      'Applies when an Express service on Railway lacks a valid production "start" script (or uses nodemon), or when a Next.js / React+Vite app lacks a "build" script.',
    howToResolve:
      'Add a clean production "build" script (e.g., "next build", "vite build", or "tsc") and a production "start" script (e.g., "node dist/index.js" or "next start") to package.json.',
    PlatformNotes: {
      vercel: 'Vercel executes "npm run build" by default for Next.js and Vite projects.',
      railway: 'Railway Nixpacks runs "npm run build" (if present) followed by "npm run start".',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/deployments/configure-a-build',
      railway: 'https://docs.railway.com/deployments/reference',
    },
  },

  evaluate(ctx: RuleEvaluationContext): Finding[] {
    const { manifest, platform, adapter } = ctx;
    const findings: Finding[] = [];

    for (const svc of manifest.services) {
      const pkgFile =
        svc.relativePath === '.' ? 'package.json' : `${svc.relativePath}/package.json`;
      const buildScript = svc.scripts.build;
      const startScript = svc.scripts.start;

      if (svc.framework === 'nextjs') {
        if (!buildScript || !buildScript.includes('next build')) {
          findings.push({
            ruleId: 'DRC004',
            title: buildScript
              ? 'Review custom Next.js production build script'
              : 'Missing Next.js production build script',
            severity: buildScript ? 'warning' : 'critical',
            confidence: buildScript ? 'medium' : 'high',
            platform,
            category: 'runtime',
            message: buildScript
              ? `DRC could not confirm that the custom build script for '${svc.name}' (${pkgFile}) runs next build.`
              : `Next.js service '${svc.name}' (${pkgFile}) has no "build" script.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `package.json scripts.build is ${buildScript ? `"${buildScript}"` : 'missing'} in ${pkgFile}`,
            file: pkgFile,
            line: 1,
            column: 1,
            suggestedFix: buildScript
              ? 'Check that your custom build script runs next build, and keep any required setup steps.'
              : 'Add `"build": "next build"` to package.json scripts.',
            fix: {
              eligible: !buildScript,
              safety: buildScript ? 'manual-guided' : 'safe-auto',
              description: buildScript
                ? `Review the custom build script in ${pkgFile}`
                : `Add a production build script to ${pkgFile}`,
            },
            docsUrl: adapter.capabilities.officialDocs.configuration,
          });
        }
        if (platform === 'railway' && (!startScript || startScript.includes('next dev'))) {
          findings.push({
            ruleId: 'DRC004',
            title: 'Missing or dev-mode Next.js start script for Railway',
            severity: 'critical',
            confidence: 'high',
            platform,
            category: 'runtime',
            message: `Next.js service '${svc.name}' (${pkgFile}) is missing a production "start": "next start" script for Railway container deployment.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `package.json scripts.start is ${startScript ? `"${startScript}"` : 'missing'} in ${pkgFile}`,
            file: pkgFile,
            line: 1,
            column: 1,
            suggestedFix: 'Set `"start": "next start"` in package.json.',
            fix: {
              eligible: true,
              safety: startScript ? 'approval-required' : 'safe-auto',
              description: `Set "start": "next start" in ${pkgFile}`,
            },
            docsUrl: adapter.capabilities.officialDocs.configuration,
          });
        }
      }

      if (svc.framework === 'react-vite' && !buildScript) {
        findings.push({
          ruleId: 'DRC004',
          title: 'Missing Vite production build script',
          severity: 'critical',
          confidence: 'high',
          platform,
          category: 'runtime',
          message: `React + Vite service '${svc.name}' (${pkgFile}) is missing a "build" script in package.json.`,
          whyItHappens: this.definition.whyItHappens,
          deploymentImpact: this.definition.deploymentImpact,
          evidence: `package.json scripts.build is missing in ${pkgFile}`,
          file: pkgFile,
          line: 1,
          column: 1,
          suggestedFix: 'Add `"build": "vite build"` to package.json scripts.',
          fix: {
            eligible: true,
            safety: 'safe-auto',
            description: `Add "build": "vite build" to ${pkgFile}`,
          },
          docsUrl: adapter.capabilities.officialDocs.configuration,
        });
      }

      if (svc.framework === 'express') {
        const hasProcfile = Boolean(manifest.configFacts.procfilePath);
        if (!startScript && !hasProcfile && platform === 'railway') {
          findings.push({
            ruleId: 'DRC004',
            title: 'Missing production start script',
            severity: 'critical',
            confidence: 'high',
            platform,
            category: 'runtime',
            message: `Express service '${svc.name}' (${pkgFile}) has no "start" script in package.json. Railway will not know how to launch the server.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact: this.definition.deploymentImpact,
            evidence: `scripts.start is missing in ${pkgFile}`,
            file: pkgFile,
            line: 1,
            column: 1,
            suggestedFix: svc.hasTypeScript
              ? 'Add `"build": "tsc"` and `"start": "node dist/index.js"` to package.json.'
              : 'Add `"start": "node index.js"` (or your entry file) to package.json.',
            fix: {
              eligible: true,
              safety: 'safe-auto',
              description: `Add production start${svc.hasTypeScript ? ' and build' : ''} script to ${pkgFile}`,
            },
            docsUrl: adapter.capabilities.officialDocs.limits,
          });
        } else if (startScript && /\b(nodemon|ts-node-dev)\b/.test(startScript)) {
          findings.push({
            ruleId: 'DRC004',
            title: 'Development watcher used in production start script',
            severity: 'warning',
            confidence: 'high',
            platform,
            category: 'runtime',
            message: `Service '${svc.name}' (${pkgFile}) uses a development file watcher (${startScript}) in "scripts.start".`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact:
              'File watchers consume unnecessary memory, may fail if devDependencies are pruned in production, and cause unexpected container restarts.',
            evidence: `"start": "${startScript}" in ${pkgFile}`,
            file: pkgFile,
            line: 1,
            column: 1,
            suggestedFix: 'Use `node` in `scripts.start` and keep `nodemon` in `scripts.dev`.',
            fix: {
              eligible: true,
              safety: 'approval-required',
              description: `Replace development watcher in ${pkgFile} scripts.start with node`,
            },
            docsUrl: adapter.capabilities.officialDocs.limits,
          });
        } else if (
          svc.hasTypeScript &&
          !buildScript &&
          startScript &&
          startScript.includes('dist/')
        ) {
          findings.push({
            ruleId: 'DRC004',
            title: 'Missing TypeScript build script for dist/ entrypoint',
            severity: 'critical',
            confidence: 'high',
            platform,
            category: 'runtime',
            message: `Service '${svc.name}' (${pkgFile}) starts from "dist/" (${startScript}) but defines no "build" script to compile TypeScript.`,
            whyItHappens: this.definition.whyItHappens,
            deploymentImpact:
              'Deployment will fail at startup because the dist/ directory is never built.',
            evidence: `"start": "${startScript}" without "build" script in ${pkgFile}`,
            file: pkgFile,
            line: 1,
            column: 1,
            suggestedFix: 'Add `"build": "tsc"` to package.json scripts.',
            fix: {
              eligible: true,
              safety: 'safe-auto',
              description: `Add "build": "tsc" to ${pkgFile}`,
            },
            docsUrl: adapter.capabilities.officialDocs.limits,
          });
        }
      }
    }

    return findings;
  },
};
