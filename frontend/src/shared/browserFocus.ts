// Tracks which browser card the user last interacted with (clicked into its page or its chrome),
// so global shortcuts (Ctrl+R reload, Ctrl +/- zoom, Ctrl+Tab) target THAT browser instead of a
// guess. Module-level and imperative on purpose: shortcut handlers read it on keydown, so no React
// re-render is needed. Cleared the moment the user clicks anything that isn't a browser card.
let lastInteractedBrowserId: string | null = null;

export function setLastInteractedBrowser(browserId: string): void {
  lastInteractedBrowserId = browserId;
}

export function clearLastInteractedBrowser(): void {
  lastInteractedBrowserId = null;
}

export function getLastInteractedBrowser(): string | null {
  return lastInteractedBrowserId;
}
