# Guide: Creating New Rules & Platform Adapters

## 1. Implementing a Deployment Rule

Every rule implements the `DeploymentRule` interface from `src/core/rule-engine.ts`:

```ts
import { Finding } from '../../core/finding';
import { DeploymentRule, RuleEvaluationContext } from '../../core/rule-engine';

export const myCustomRule: DeploymentRule = {
  definition: {
    id: 'DRC013',
    name: 'Descriptive rule title',
    category: 'runtime',
    defaultSeverity: 'warning',
    defaultConfidence: 'high',
    platforms: ['vercel', 'railway'],
    autofixEligible: false,
    fixSafety: 'manual-guided',
    summary: 'One-sentence summary.',
    whatItMeans: 'Plain-English explanation...',
    whyItHappens: 'Root cause in local dev...',
    deploymentImpact: 'What breaks in production...',
    whenItApplies: 'Exact trigger conditions...',
    howToResolve: 'Step-by-step fix...',
    PlatformNotes: {
      vercel: 'Vercel-specific note...',
      railway: 'Railway-specific note...',
    },
    docsUrls: {
      vercel: 'https://vercel.com/docs/...',
      railway: 'https://docs.railway.com/...',
    },
  },
  evaluate(ctx: RuleEvaluationContext): Finding[] {
    // Inspect ctx.manifest and ctx.adapter.capabilities without mutating files
    return [];
  },
};
```

Register the rule in `src/core/rule-registry.ts` and add positive, negative, and edge-case tests in `tests/unit/rules.test.ts`.

## 2. Adding a Hosting Platform Adapter

Implement `PlatformAdapter` in `src/platforms/<provider>.ts` with `PlatformCapabilitySpec` metadata and register it in `getPlatformAdapter()`.
