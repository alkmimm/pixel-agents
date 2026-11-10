/**
 * pixel-agents-secure: mask what looks like a credential in text the office
 * viewer shows (tool labels, the H17 conversation). Best effort, by pattern:
 * a password written in plain words is not recognised.
 *
 * Every pattern is linear in the input (bounded quantifiers, no nested
 * unbounded runs around an alternation), and callers cut the text BEFORE
 * masking: a crafted prompt must never be able to stall the viewer's event
 * loop (see the timing test in hardening.test.ts).
 */

export const REDACTED = '<redacted>';

/** A `name=value` whose name says it holds a secret. */
const SECRET_NAME =
  /password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret/i;

const PATTERNS: Array<[RegExp, string]> = [
  // A PEM private key, to its END line or to the end of the text.
  [
    /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g,
    REDACTED,
  ],
  [/\bsk-ant-[A-Za-z0-9_-]{10,2048}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,2048}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,255}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,255}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,255}/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,255}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}/g, REDACTED],
  // Authorization values (the lookahead wants a digit, so prose is left alone).
  [
    /\b(Bearer|Basic)[ \t]{1,8}(?=[A-Za-z._~+/=-]{0,256}[0-9])[A-Za-z0-9._~+/=-]{12,2048}/gi,
    `$1 ${REDACTED}`,
  ],
  // user:password@ in a URL.
  [/(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/]{1,256}):[^\s@/]{1,256}@/gi, `$1:${REDACTED}@`],
];

/** A name, its separator and an opening quote. The name is judged in code
 *  (not by an alternation between two unbounded runs), and the value is read
 *  only for a secret name, so "Running: TOKEN=x" still reaches "TOKEN". */
const NAME_SEP = /\b([A-Za-z0-9_.-]{1,64})["']?[ \t]{0,8}[:=][ \t]{0,8}["']?/g;
const VALUE = /[^\s"',;]*/y;

function maskNamedValues(text: string): string {
  const names = new RegExp(NAME_SEP.source, 'g');
  let out = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = names.exec(text)) !== null) {
    if (!SECRET_NAME.test(m[1])) continue;
    const valueStart = m.index + m[0].length;
    VALUE.lastIndex = valueStart;
    const value = VALUE.exec(text)?.[0] ?? '';
    if (value.length < 4) continue;
    out += text.slice(cursor, valueStart) + REDACTED;
    cursor = valueStart + value.length;
    names.lastIndex = cursor;
  }
  return out + text.slice(cursor);
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return maskNamedValues(out);
}

/** Cut first (with room for a secret that crosses the limit), mask, then cut
 *  to the limit. Masking never sees more than `max + 512` characters. */
export function maskAndClip(text: string, max: number): string {
  const masked = redactSecrets(text.slice(0, max + 512));
  return masked.length > max || text.length > max + 512 ? masked.slice(0, max) + '…' : masked;
}

/** The tool labels a read-only (viewer) client receives, masked like the
 *  conversation: the same label must not be hidden in one place and shown in
 *  another. Other messages pass unchanged. */
export function maskToolLabels(message: Record<string, unknown>): Record<string, unknown> {
  if (
    (message.type === 'agentToolStart' || message.type === 'subagentToolStart') &&
    typeof message.status === 'string'
  ) {
    return { ...message, status: redactSecrets(message.status) };
  }
  return message;
}
