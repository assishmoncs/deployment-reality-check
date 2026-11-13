const SECRET_KEY_PATTERN = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|service[_-]?role|access[_-]?key|client[_-]?secret|jwt|auth|dsn|connection[_-]?string|database[_-]?url)/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk_(live|test)_[0-9a-zA-Z]{10,}\b/g,
  /\bpk_(live|test)_[0-9a-zA-Z]{10,}\b/g,
  /\bgh[pousr]_[0-9a-zA-Z]{20,}\b/g,
  /\bgithub_pat_[0-9a-zA-Z_]{20,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{30,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:[^@\s]+@[^\s"']+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g,
];

export function isSensitiveEnvName(name: string): boolean {
  const upper = name.trim().toUpperCase();
  if (
    upper === 'NODE_ENV' ||
    upper === 'PORT' ||
    upper === 'HOST' ||
    upper === 'TZ' ||
    upper === 'CI' ||
    upper === 'PUBLIC_URL' ||
    upper === 'BASE_URL'
  ) {
    return false;
  }
  return SECRET_KEY_PATTERN.test(upper);
}

export function redactSecrets(input: string): string {
  if (!input) return input;
  let output = input;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, (match) => {
      if (match.includes('://')) {
        return match.replace(/:\/\/([^:\s/]+):([^@\s]+)@/, '://$1:[REDACTED]@');
      }
      return '[REDACTED_SECRET]';
    });
  }

  output = output.replace(
    /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.+)$/gm,
    (_full, prefix: string, rawVal: string) => {
      const keyMatch = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)/);
      const keyName = keyMatch ? keyMatch[1] ?? '' : '';
      const trimmedVal = rawVal.trim();
      if (
        trimmedVal === '' ||
        trimmedVal.startsWith('#') ||
        trimmedVal.includes('your_') ||
        trimmedVal.includes('example') ||
        trimmedVal.includes('<') ||
        trimmedVal === '""' ||
        trimmedVal === "''"
      ) {
        return `${prefix}${rawVal}`;
      }
      if (isSensitiveEnvName(keyName)) {
        return `${prefix}[REDACTED]`;
      }
      return `${prefix}${rawVal}`;
    },
  );

  return output;
}

export function generateSafeEnvPlaceholder(varName: string): string {
  const upper = varName.toUpperCase();
  if (upper.includes('DATABASE_URL') || upper.includes('POSTGRES')) {
    return 'postgresql://user:password@hostname:5432/dbname';
  }
  if (upper.includes('URL') || upper.includes('ORIGIN') || upper.includes('ENDPOINT') || upper.includes('HOST')) {
    return 'https://api.example.com';
  }
  if (upper.includes('PORT')) {
    return '3000';
  }
  if (upper === 'NODE_ENV') {
    return 'production';
  }
  if (isSensitiveEnvName(upper)) {
    return `your_${varName.toLowerCase()}_here`;
  }
  return `replace_with_${varName.toLowerCase()}`;
}
