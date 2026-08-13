import i18n from '@/shared/i18n/i18n';

/** Lazy lookup for step-definition copy: step modules are evaluated at import time, so a bare
 * `i18n.t(...)` there would freeze whichever language loaded first. Returning a thunk defers the
 * lookup to when the op actually runs, so switching language mid-session takes effect. */
export const tr = (key: string): (() => string) => () => i18n.t(key);
