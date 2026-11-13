import { Finding, PlatformId, RuleDefinition } from '../core/finding';
import { getAllRuleDefinitions } from '../core/rule-registry';
import { redactSecrets } from '../utils/redactor';

function mapSeverityToSarifLevel(severity: Finding['severity']): 'error' | 'warning' | 'note' {
  switch (severity) {
    case 'critical':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'note';
  }
}

export function renderSarifScanReport(params: {
  version: string;
  platform: PlatformId;
  findings: Finding[];
  rules?: RuleDefinition[];
}): string {
  const rules = params.rules ?? getAllRuleDefinitions();

  const sarifRules = rules.map((r) => ({
    id: r.id,
    name: r.name,
    shortDescription: { text: r.summary },
    fullDescription: { text: r.whatItMeans },
    helpUri: r.docsUrls[params.platform],
    defaultConfiguration: {
      level: mapSeverityToSarifLevel(r.defaultSeverity),
    },
    properties: {
      category: r.category,
      confidence: r.defaultConfidence,
      autofixEligible: r.autofixEligible,
    },
  }));

  const results = params.findings.map((f) => ({
    ruleId: f.ruleId,
    level: mapSeverityToSarifLevel(f.severity),
    message: {
      text: `${redactSecrets(f.message)} Suggested fix: ${redactSecrets(f.suggestedFix)}`,
    },
    locations: f.file
      ? [
          {
            physicalLocation: {
              artifactLocation: {
                uri: f.file.replace(/\\/g, '/'),
              },
              region: {
                startLine: f.line ?? 1,
                startColumn: f.column ?? 1,
              },
            },
          },
        ]
      : [],
    properties: {
      confidence: f.confidence,
      platform: f.platform,
      category: f.category,
      evidence: redactSecrets(f.evidence),
      autofixEligible: f.fix.eligible,
      fixSafety: f.fix.safety,
    },
  }));

  const sarifLog = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Deployment Reality Check (DRC)',
            informationUri: 'https://github.com/deployment-reality-check/deployment-reality-check',
            version: params.version,
            rules: sarifRules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarifLog, null, 2);
}
