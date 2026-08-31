---
category: Canvas
---

# BrowserCard

A live browser session on the canvas, spawned when an agent needs the web. Only
back/forward/reload live in the nav bar — no home button, no hamburger. The tab strip
doubles as the card's drag handle. `agentActive` adds the small "AI" badge and the accent
highlight halo for while an agent is actively driving the page.

```tsx
<BrowserCard
  x={560} y={80} width={640} height={420}
  tabs={[{ title: 'GitHub · maestro-desktop', active: true }, { title: 'New tab' }]}
  url="github.com/gmartinstech/maestro-desktop/pull/12"
  agentActive
/>
```
