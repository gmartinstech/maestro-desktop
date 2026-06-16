[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/agentsSlice](../README.md) / AgentSession

# Interface: AgentSession

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:58](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L58)

## Properties

### active\_branch\_id

> **active\_branch\_id**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:78](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L78)

***

### active\_mcps?

> `optional` **active\_mcps?**: `string`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:89](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L89)

***

### allowed\_tools

> **allowed\_tools**: `string`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:69](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L69)

***

### branch\_name

> **branch\_name**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:66](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L66)

***

### branches

> **branches**: `Record`\<`string`, [`MessageBranch`](MessageBranch.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:77](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L77)

***

### browser\_id?

> `optional` **browser\_id?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:83](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L83)

***

### cache\_read\_pct?

> `optional` **cache\_read\_pct?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:91](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L91)

***

### cache\_read\_tokens?

> `optional` **cache\_read\_tokens?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:92](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L92)

***

### closed\_at?

> `optional` **closed\_at?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:72](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L72)

***

### compacted\_through\_msg\_id?

> `optional` **compacted\_through\_msg\_id?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:98](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L98)

***

### connection\_state?

> `optional` **connection\_state?**: `"live"` \| `"reconnecting"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:100](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L100)

Frontend-only WS state, decoupled from session.status so reconnects don't fake terminal states.

***

### context\_overflow?

> `optional` **context\_overflow?**: \{ `at`: `string`; `message`: `string`; `reason`: `string`; \} \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:95](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L95)

***

### context\_window?

> `optional` **context\_window?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:93](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L93)

***

### cost\_usd

> **cost\_usd**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:73](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L73)

***

### created\_at

> **created\_at**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:71](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L71)

***

### ctx\_used\_pct?

> `optional` **ctx\_used\_pct?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:90](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L90)

***

### dashboard\_id?

> `optional` **dashboard\_id?**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:82](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L82)

***

### framework\_overhead\_tokens?

> `optional` **framework\_overhead\_tokens?**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:94](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L94)

***

### id

> **id**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:59](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L59)

***

### max\_turns

> **max\_turns**: `number` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:70](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L70)

***

### mcp\_suggestions?

> `optional` **mcp\_suggestions?**: `object`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:96](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L96)

#### description

> **description**: `string`

#### id

> **id**: `string`

#### reason?

> `optional` **reason?**: `string`

#### title

> **title**: `string`

***

### mcp\_suggestions\_is\_vague?

> `optional` **mcp\_suggestions\_is\_vague?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:97](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L97)

***

### memory\_learned?

> `optional` **memory\_learned?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:87](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L87)

***

### memory\_recalled?

> `optional` **memory\_recalled?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:86](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L86)

Browser memory signals that drive the subtle "Remembered"/"Learned" card chip.

***

### messages

> **messages**: [`AgentMessage`](AgentMessage.md)[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:75](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L75)

***

### mode

> **mode**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:64](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L64)

***

### model

> **model**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:63](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L63)

***

### name

> **name**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:60](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L60)

***

### parent\_session\_id?

> `optional` **parent\_session\_id?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:84](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L84)

***

### pending\_approvals

> **pending\_approvals**: [`ApprovalRequest`](ApprovalRequest.md)[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:76](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L76)

***

### provider

> **provider**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:62](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L62)

***

### sdk\_session\_id

> **sdk\_session\_id**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:67](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L67)

***

### status

> **status**: `"draft"` \| `"running"` \| `"waiting_approval"` \| `"completed"` \| `"error"` \| `"stopped"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:61](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L61)

***

### system\_prompt

> **system\_prompt**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:68](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L68)

***

### target\_directory?

> `optional` **target\_directory?**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:80](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L80)

***

### thinking\_level?

> `optional` **thinking\_level?**: `"off"` \| `"low"` \| `"medium"` \| `"high"` \| `"auto"`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:88](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L88)

***

### tokens

> **tokens**: `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:74](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L74)

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### tool\_group\_meta

> **tool\_group\_meta**: `Record`\<`string`, [`ToolGroupMeta`](ToolGroupMeta.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:81](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L81)

***

### turn\_label?

> `optional` **turn\_label?**: \{ `label`: `string`; `turn_id`: `string`; \} \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:102](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L102)

Aux-LLM verb-phrase for the current turn; ThinkingBubble swaps in then back when turn ends.

***

### worktree\_path

> **worktree\_path**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/agentsSlice.ts:65](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/agentsSlice.ts#L65)
