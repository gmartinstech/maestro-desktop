---
category: Canvas
---

# CanvasCardFrame

The shared visual recipe every canvas card is built on: absolute positioning at canvas
coordinates, the resting border/shadow, and the two override states — `selected` (a
hardcoded `#3b82f6` ring, matching the app exactly) and `highlighted` (the accent halo a
card gets right after being created or jumped to via search). Compose it directly only when
building a new card type; `AgentCard`, `BrowserCard`, `ViewCard` and `NoteCard` already wrap it.

```tsx
<CanvasCardFrame x={40} y={120} width={480} height={280} selected>
  <MyCardHeader />
  <MyCardBody />
</CanvasCardFrame>
```
