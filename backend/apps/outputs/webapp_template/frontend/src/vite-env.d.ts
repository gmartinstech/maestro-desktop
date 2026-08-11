/// <reference types="vite/client" />
/// <reference types="vite-plugin-pages/client-react" />

// Render-health beacon flags the Maestro App Builder host reads off the preview.
interface Window {
  __maestro_rendered?: boolean;
  __maestro_render_failed?: boolean;
  __maestro_last_error?: string;
}
