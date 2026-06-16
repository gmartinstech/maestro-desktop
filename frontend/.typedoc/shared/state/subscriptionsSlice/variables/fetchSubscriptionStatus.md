[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/subscriptionsSlice](../README.md) / fetchSubscriptionStatus

# Variable: fetchSubscriptionStatus

> `const` **fetchSubscriptionStatus**: `AsyncThunk`\<[`SubscriptionStatus`](../interfaces/SubscriptionStatus.md), \{ `preserveTransient?`: `boolean`; \} \| `undefined`, `AsyncThunkConfig`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/subscriptionsSlice.ts:32](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/subscriptionsSlice.ts#L32)

Mirror /agents/subscriptions/status into Redux; preserveTransient debounces is_running() false negatives.
