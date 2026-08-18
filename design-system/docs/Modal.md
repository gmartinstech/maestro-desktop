---
category: Feedback
---

# Modal

Centred dialog. The scrim is absolutely positioned, so mount it inside AppShell, not at the document root.

```tsx
<Modal open title="Delete agent?" subtitle="This cannot be undone."
  footer={<><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></>}>
  Runs already recorded are kept.
</Modal>
```
