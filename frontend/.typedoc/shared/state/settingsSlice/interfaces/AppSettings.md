[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/settingsSlice](../README.md) / AppSettings

# Interface: AppSettings

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:38](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L38)

## Properties

### allow\_experimental\_updates

> **allow\_experimental\_updates**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:58](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L58)

***

### anthropic\_api\_key

> **anthropic\_api\_key**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:48](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L48)

***

### auto\_reveal\_sub\_agents

> **auto\_reveal\_sub\_agents**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:56](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L56)

***

### auto\_select\_mode\_on\_new\_agent

> **auto\_select\_mode\_on\_new\_agent**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:54](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L54)

***

### browser\_homepage

> **browser\_homepage**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:53](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L53)

***

### connection\_mode?

> `optional` **connection\_mode?**: `"own_key"` \| `"openswarm-pro"` \| `"free-trial"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:60](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L60)

Managed subscription state; surfaces only when user has subscribed via cloud.

***

### custom\_providers?

> `optional` **custom\_providers?**: [`CustomProvider`](CustomProvider.md)[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:52](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L52)

***

### default\_folder

> **default\_folder**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:40](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L40)

***

### default\_max\_turns

> **default\_max\_turns**: `number` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:43](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L43)

***

### default\_mode

> **default\_mode**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:42](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L42)

***

### default\_model

> **default\_model**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:41](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L41)

***

### default\_system\_prompt

> **default\_system\_prompt**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:39](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L39)

***

### default\_thinking\_level

> **default\_thinking\_level**: `"off"` \| `"low"` \| `"medium"` \| `"high"` \| `"auto"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:44](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L44)

***

### dev\_mode

> **dev\_mode**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:57](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L57)

***

### expand\_new\_chats\_in\_dashboard

> **expand\_new\_chats\_in\_dashboard**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:55](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L55)

***

### free\_trial\_remaining?

> `optional` **free\_trial\_remaining?**: `number` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:65](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L65)

***

### free\_trial\_runs\_limit?

> `optional` **free\_trial\_runs\_limit?**: `number` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:66](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L66)

***

### free\_trial\_token?

> `optional` **free\_trial\_token?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:64](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L64)

Zero-config free trial: server-owned, set by the cloud mint. remaining drives the onboarding "runs low" nudge.

***

### google\_api\_key?

> `optional` **google\_api\_key?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:50](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L50)

***

### installation\_id?

> `optional` **installation\_id?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:75](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L75)

Anonymous device id (first-run generated); stitches anon to authed PostHog Persons.

***

### new\_agent\_shortcut

> **new\_agent\_shortcut**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:47](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L47)

***

### openai\_api\_key?

> `optional` **openai\_api\_key?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:49](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L49)

***

### openrouter\_api\_key?

> `optional` **openrouter\_api\_key?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:51](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L51)

***

### openswarm\_bearer\_token?

> `optional` **openswarm\_bearer\_token?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:61](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L61)

***

### openswarm\_proxy\_url?

> `optional` **openswarm\_proxy\_url?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:62](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L62)

***

### openswarm\_subscription\_expires?

> `optional` **openswarm\_subscription\_expires?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:68](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L68)

***

### openswarm\_subscription\_plan?

> `optional` **openswarm\_subscription\_plan?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:67](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L67)

***

### openswarm\_usage\_cached?

> `optional` **openswarm\_usage\_cached?**: [`SubscriptionUsage`](SubscriptionUsage.md) \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:69](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L69)

***

### signin\_method?

> `optional` **signin\_method?**: `"google"` \| `"email"` \| `"stripe"` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:73](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L73)

***

### theme

> **theme**: `"light"` \| `"dark"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:46](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L46)

***

### user\_email?

> `optional` **user\_email?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:72](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L72)

***

### user\_id?

> `optional` **user\_id?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:71](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L71)

Identity populated by /api/auth/signin-activate; Stripe checkout also fills these.

***

### zoom\_sensitivity

> **zoom\_sensitivity**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:45](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L45)
