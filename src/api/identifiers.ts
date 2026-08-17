const CANONICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isCanonicalId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_ID_PATTERN.test(value);
}
