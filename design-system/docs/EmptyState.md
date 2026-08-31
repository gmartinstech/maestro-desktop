---
category: Surfaces
---

# EmptyState

Zero-data placeholder. Always give it the one action that resolves the emptiness.

```tsx
<EmptyState icon={<Icon name="agent" size={22} />} title="No agents yet"
  description="Create one to start orchestrating work."
  action={<Button icon={<Icon name="plus" />}>New agent</Button>} />
```
