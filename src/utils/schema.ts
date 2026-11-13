export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  issues: ValidationIssue[];
}

export function validateJsonSafe(rawContent: string, fileLabel: string): ValidationResult<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(rawContent);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        success: false,
        issues: [{ path: fileLabel, message: 'Expected top-level JSON object' }],
      };
    }
    return {
      success: true,
      data: parsed as Record<string, unknown>,
      issues: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      issues: [{ path: fileLabel, message: `Invalid JSON syntax: ${msg}` }],
    };
  }
}
