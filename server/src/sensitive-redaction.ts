const SENSITIVE_TEXT_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern: /(SESSDATA=)[^;,\s&"']+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /(bili_jct=)[^;,\s&"']+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /(csrf(?:_token)?[=:])[^;,\s&"']+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /(token[=:])[^;,\s&"']+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /(Bearer\s+)[^;,\s&"']+/gi,
    replacement: "$1[REDACTED]",
  },
];

export function redactSensitiveText(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value);
  for (const { pattern, replacement } of SENSITIVE_TEXT_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}
