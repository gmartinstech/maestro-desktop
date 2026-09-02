// BRW-4 GATE-ONLY harness: mounts the REAL BrowserCanvasCdp.tsx standalone (no Redux/i18n/MUI
// bootstrap) so the manual real-integration gate can drive the EXACT component
// BrowserCard.tsx renders under MAESTRO_BROWSER_ENGINE=cdp, not a stand-in.
//
// Never imported by src/index.tsx -- the real app's production build (`npm run build`) never
// reaches this module, so it contributes nothing to the shipped bundle. Bundled ONLY by the
// separate frontend/webpack.harness.config.js, invoked by hand (npx webpack --config
// webpack.harness.config.js) for scripts/browserCanvasCdp.integration-check.mjs. See that
// script's header for the full gate this feeds.
import React from 'react';
import { createRoot } from 'react-dom/client';
import BrowserCanvasCdp from './BrowserCanvasCdp';

interface HarnessProps {
  browserId: string;
  wsUrl: string;
  url: string;
}

declare global {
  interface Window {
    __HARNESS_PROPS__?: HarnessProps;
  }
}

const props: HarnessProps = window.__HARNESS_PROPS__ ?? { browserId: 'harness', wsUrl: '', url: '' };
const container = document.getElementById('root');
if (!container) throw new Error('browserCanvasCdpHarness: #root not found in the harness HTML');
container.style.width = '1280px';
container.style.height = '900px';
container.style.position = 'relative';
const root = createRoot(container);
root.render(<BrowserCanvasCdp browserId={props.browserId} wsUrl={props.wsUrl} url={props.url} />);
