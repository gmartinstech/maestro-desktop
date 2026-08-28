---
category: Conversation
---

# Composer

The prompt input. Put attach/model controls in `tools` and the send Button in `action`.

```tsx
<Composer value={draft} onChange={setDraft}
  action={<Button icon={<Icon name="send" size={15} />} size="sm">Send</Button>} />
```
