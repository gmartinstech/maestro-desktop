import type { TFunction } from 'i18next';

/** Plain-language session status for user-facing chips; the raw enum values read as dev-speak. */
export function friendlyStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'running': return t('common.status.working');
    case 'waiting_approval': return t('common.status.needsYourOk');
    case 'completed': return t('common.status.done');
    case 'error': return t('common.status.needsAttention');
    // Unknown backend enums have no key, so the raw value is de-underscored as a last resort.
    default: return status.replace(/_/g, ' ');
  }
}
