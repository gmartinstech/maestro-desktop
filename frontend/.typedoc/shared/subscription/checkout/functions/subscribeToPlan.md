[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/subscription/checkout](../README.md) / subscribeToPlan

# Function: subscribeToPlan()

> **subscribeToPlan**(`plan`, `billingInterval`, `source`, `opts?`): `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/subscription/checkout.ts:12](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/subscription/checkout.ts#L12)

Create a Stripe Checkout session and open the URL externally; used by all subscribe CTAs.

## Parameters

### plan

[`OpenSwarmPlan`](../type-aliases/OpenSwarmPlan.md)

### billingInterval

[`BillingInterval`](../type-aliases/BillingInterval.md)

### source

[`CheckoutSource`](../type-aliases/CheckoutSource.md)

### opts?

`SubscribeOptions` = `{}`

## Returns

`Promise`\<`void`\>
