// Joins class names, dropping anything falsy — the one styling helper the components share.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
