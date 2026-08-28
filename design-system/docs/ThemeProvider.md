---
category: Foundations
---

# ThemeProvider

Installs the token layer. Nothing below it is styled without it — wrap the app root, and wrap any isolated preview.

```tsx
<ThemeProvider theme="dark" fullHeight>
  <AppShell titleBar={<TitleBar />}>…</AppShell>
</ThemeProvider>
```
