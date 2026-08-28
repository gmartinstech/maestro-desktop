---
category: Canvas
---

# AgentCard

The primary card on the dashboard canvas — one per running or finished agent turn. Deliberately
spare: a title, a status word, an optional memory chip, and a single close button. No avatar,
no kebab menu, no status dot in the header. Collapsed shows one preview line with a pulsing
accent dot; expanded shows the transcript in `children`. `approval` renders the
awaiting-approval warning block instead of the preview line.

```tsx
<AgentCard
  x={40} y={120} title="Release Notes" status="running"
  model="Claude Opus 5" elapsed="00:41" cost="$0.02" hasMemory
  preview="Reading electron/main.js to check the update feed change…"
/>
```
