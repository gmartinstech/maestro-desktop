---
category: Shell
---

# TitleBar

The 38px window chrome. Set `platform` correctly — win reserves 138px on the right for the native buttons, mac reserves 78px on the left for the traffic lights.

```tsx
<TitleBar platform="win" leading={<MaestroLogo size={22} />} title="Maestro Studio"
  actions={<IconButton icon={<Icon name="search" />} label="Search" size="sm" />} />
```
