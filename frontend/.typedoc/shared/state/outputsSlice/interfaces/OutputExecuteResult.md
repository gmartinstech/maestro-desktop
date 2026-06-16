[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/outputsSlice](../README.md) / OutputExecuteResult

# Interface: OutputExecuteResult

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:44](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L44)

## Properties

### backend\_result

> **backend\_result**: `Record`\<`string`, `any`\> \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:49](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L49)

***

### code\_preview?

> `optional` **code\_preview?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:55](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L55)

***

### error

> **error**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:52](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L52)

***

### frontend\_code

> **frontend\_code**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:47](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L47)

***

### input\_data

> **input\_data**: `Record`\<`string`, `any`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:48](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L48)

***

### output\_id

> **output\_id**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:45](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L45)

***

### output\_name

> **output\_name**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:46](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L46)

***

### stderr

> **stderr**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:51](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L51)

***

### stdout

> **stdout**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:50](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L50)

***

### warnings?

> `optional` **warnings?**: `string`[] \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/outputsSlice.ts:54](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/outputsSlice.ts#L54)

Set when AST validator flagged risky code without force=true; resubmit with force to bypass.
