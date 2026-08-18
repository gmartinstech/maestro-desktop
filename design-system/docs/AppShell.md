---
category: Shell
---

# AppShell

The window frame: title bar, rail, scrolling content, plus toast and overlay layers. Give it a fixed height — the content pane scrolls, the frame does not.

```tsx
<AppShell titleBar={<TitleBar />} sidebar={<Sidebar>…</Sidebar>}
  toasts={<Toast message="Run finished" tone="success" />}>
  <PageHeader title="Dashboard" />
</AppShell>
```
