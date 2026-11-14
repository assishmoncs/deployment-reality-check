# Contributing to Deployment Reality Check (DRC)

Thank you for your interest in contributing to **Deployment Reality Check (DRC)**!

## Local Development Setup

```bash
git clone https://github.com/assishmoncs/deployment-reality-check.git
cd deployment-reality-check
npm ci
npm run build
npm test
```

## Quality Gates

Before submitting a pull request, ensure all validation checks pass locally:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm pack --dry-run
```

## Adding a New Rule or Platform

See [`docs/contributing-rules.md`](./docs/contributing-rules.md) for a step-by-step guide on authoring new deterministic rules, writing positive/negative/edge-case tests, and registering platform capability adapters.
