---
category: Data
---

# Table

Dense data table. Mark numeric columns so they right-align in tabular mono. Wrap in a flush Card for the panel treatment.

```tsx
<Table
  columns={[
    { key: 'agent', header: 'Agent', render: r => r.agent },
    { key: 'ms', header: 'Duration', numeric: true, render: r => r.ms },
  ]}
  rows={rows}
/>
```
