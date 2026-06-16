[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/agentsSlice](../README.md) / AgentMessage

# Interface: AgentMessage

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:6](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L6)

## Properties

### attached\_skills?

> `optional` **attached\_skills?**: `object`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:14](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L14)

#### id

> **id**: `string`

#### name

> **name**: `string`

***

### branch\_id

> **branch\_id**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:11](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L11)

***

### client\_message\_id?

> `optional` **client\_message\_id?**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:19](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L19)

Round-tripped optimistic-bubble id; addMessage dedupes the echo against the placeholder.

***

### content

> **content**: `any`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:9](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L9)

***

### context\_paths?

> `optional` **context\_paths?**: `object`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:13](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L13)

#### path

> **path**: `string`

#### type

> **type**: `string`

***

### elapsed\_ms?

> `optional` **elapsed\_ms?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:23](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L23)

Server-stamped duration/token counts; today only thinking messages set these.

***

### forced\_tools?

> `optional` **forced\_tools?**: `string`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:15](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L15)

***

### hidden?

> `optional` **hidden?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:17](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L17)

***

### id

> **id**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:7](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L7)

***

### images?

> `optional` **images?**: `object`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:16](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L16)

#### data

> **data**: `string`

#### media\_type

> **media\_type**: `string`

***

### input\_tokens?

> `optional` **input\_tokens?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:26](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L26)

Input-side token count for the turn (fresh + cache_creation + cache_read).

***

### optimistic\_status?

> `optional` **optimistic\_status?**: `"pending"` \| `"failed"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:21](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L21)

Frontend-only optimistic lifecycle; dropped on server-echoed messages.

***

### parent\_id

> **parent\_id**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:12](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L12)

***

### role

> **role**: `"user"` \| `"assistant"` \| `"tool_call"` \| `"tool_result"` \| `"system"` \| `"thinking"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:8](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L8)

***

### timestamp

> **timestamp**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:10](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L10)

***

### tokens?

> `optional` **tokens?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:24](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L24)

***

### tool\_count?

> `optional` **tool\_count?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:27](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L27)
