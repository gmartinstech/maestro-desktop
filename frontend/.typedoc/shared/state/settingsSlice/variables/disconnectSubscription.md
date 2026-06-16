[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/settingsSlice](../README.md) / disconnectSubscription

# Variable: disconnectSubscription

> `const` **disconnectSubscription**: `AsyncThunk`\<`boolean`, `void`, `AsyncThunkConfig`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:221](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L221)

POST /api/subscription/disconnect; clears bearer, reverts to own_key. Doesn't cancel Stripe.
