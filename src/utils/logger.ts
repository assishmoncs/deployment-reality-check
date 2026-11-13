export interface StyleOptions {
  noColor?: boolean;
}

export function shouldUseColor(noColorFlag = false): boolean {
  if (noColorFlag) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout && process.stdout.isTTY);
}

export class TerminalStyler {
  private readonly enabled: boolean;

  constructor(options: StyleOptions = {}) {
    this.enabled = shouldUseColor(options.noColor);
  }

  private wrap(code: number, resetCode: number, text: string): string {
    if (!this.enabled) return text;
    return `\u001b[${code}m${text}\u001b[${resetCode}m`;
  }

  bold(text: string): string {
    return this.wrap(1, 22, text);
  }

  dim(text: string): string {
    return this.wrap(2, 22, text);
  }

  red(text: string): string {
    return this.wrap(31, 39, text);
  }

  green(text: string): string {
    return this.wrap(32, 39, text);
  }

  yellow(text: string): string {
    return this.wrap(33, 39, text);
  }

  blue(text: string): string {
    return this.wrap(34, 39, text);
  }

  cyan(text: string): string {
    return this.wrap(36, 39, text);
  }

  gray(text: string): string {
    return this.wrap(90, 39, text);
  }
}
