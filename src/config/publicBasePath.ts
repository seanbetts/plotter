export function normalizePublicBasePath(value: string | undefined): string {
  if (!value) return '/';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('..') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new Error(`Invalid public base path: ${value}`);
  }
  return value === '/' ? '/' : `${value.replace(/\/+$/, '')}/`;
}
