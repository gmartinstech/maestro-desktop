[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/AgentChat/ChatInput/types](../README.md) / ChatInputHandle

# Interface: ChatInputHandle

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/types.ts:19](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/types.ts#L19)

## Properties

### getConfig

> **getConfig**: () => `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/types.ts:20](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/types.ts#L20)

#### Returns

`object`

##### contextPaths

> **contextPaths**: [`ContextPath`](../../../../../components/editor/DirectoryBrowser/interfaces/ContextPath.md)[]

##### forcedTools

> **forcedTools**: [`ForcedToolGroup`](ForcedToolGroup.md)[]

##### prompt

> **prompt**: `string`

***

### setContent

> **setContent**: (`prompt`, `contextPaths?`, `forcedTools?`) => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/types.ts:21](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/types.ts#L21)

#### Parameters

##### prompt

`string`

##### contextPaths?

[`ContextPath`](../../../../../components/editor/DirectoryBrowser/interfaces/ContextPath.md)[]

##### forcedTools?

[`ForcedToolGroup`](ForcedToolGroup.md)[]

#### Returns

`void`
