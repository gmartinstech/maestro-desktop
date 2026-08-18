---
category: Shell
---

# SidebarSection

Collapsible group heading inside the rail — "Dashboards", "Apps", "Sessions".

```tsx
<SidebarSection label="Apps" expanded={open} onToggle={() => setOpen(!open)}>
  <SidebarItem label="Commands" icon={<Icon name="terminal" />} />
</SidebarSection>
```
