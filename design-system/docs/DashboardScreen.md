---
category: Templates
---

# DashboardScreen

The app's real home screen: a pan/zoom canvas holding `AgentCard`, `BrowserCard`, `ViewCard`
and `NoteCard` over a dotted grid, framed by the desktop shell — not a KPI/stats page. This is
a reference layout to copy from; edit the individual canvas card components (in the Canvas
group) for the pieces you actually want to change. `empty` swaps the cards for the app's real
first-run state (`CanvasEmptyState`).

```tsx
<DashboardScreen />
<DashboardScreen dashboardName="New dashboard" empty />
```
