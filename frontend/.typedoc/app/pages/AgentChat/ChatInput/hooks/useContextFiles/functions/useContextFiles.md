[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/AgentChat/ChatInput/hooks/useContextFiles](../README.md) / useContextFiles

# Function: useContextFiles()

> **useContextFiles**(`currentModelCtx`, `model`, `contextEstimate`, `sessionFrameworkOverhead`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/hooks/useContextFiles.ts:33](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/hooks/useContextFiles.ts#L33)

## Parameters

### currentModelCtx

`number`

### model

`string`

### contextEstimate

\{ `limit`: `number`; `used`: `number`; \} \| `undefined`

### sessionFrameworkOverhead

`number`

## Returns

`object`

### contextPaths

> **contextPaths**: [`ContextPath`](../../../../../../components/editor/DirectoryBrowser/interfaces/ContextPath.md)[]

### copiedPathIdx

> **copiedPathIdx**: `number` \| `null`

### detachAllOversize

> **detachAllOversize**: () => `void`

#### Returns

`void`

### detachOversize

> **detachOversize**: (`path`) => `void`

#### Parameters

##### path

`string`

#### Returns

`void`

### forcedTools

> **forcedTools**: [`ForcedToolGroup`](../../../types/interfaces/ForcedToolGroup.md)[]

### isUploading

> **isUploading**: `boolean`

### oversizeQueue

> **oversizeQueue**: `object`[]

### pendingKinds

> **pendingKinds**: `Set`\<`string`\>

### pendingPayloadEstimate

> **pendingPayloadEstimate**: `number`

### pendingSendRef

> **pendingSendRef**: `MutableRefObject`\<(() => `void`) \| `null`\>

### sendBlock

> **sendBlock**: [`SendBlock`](../type-aliases/SendBlock.md)

### setContextPaths

> **setContextPaths**: `Dispatch`\<`SetStateAction`\<[`ContextPath`](../../../../../../components/editor/DirectoryBrowser/interfaces/ContextPath.md)[]\>\>

### setCopiedPathIdx

> **setCopiedPathIdx**: `Dispatch`\<`SetStateAction`\<`number` \| `null`\>\>

### setForcedTools

> **setForcedTools**: `Dispatch`\<`SetStateAction`\<[`ForcedToolGroup`](../../../types/interfaces/ForcedToolGroup.md)[]\>\>

### setSendBlock

> **setSendBlock**: `Dispatch`\<`SetStateAction`\<[`SendBlock`](../type-aliases/SendBlock.md)\>\>

### setSummarizeError

> **setSummarizeError**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### summarizeAllOversize

> **summarizeAllOversize**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### summarizeError

> **summarizeError**: `string` \| `null`

### summarizeOversize

> **summarizeOversize**: (`path`) => `Promise`\<`void`\>

#### Parameters

##### path

`string`

#### Returns

`Promise`\<`void`\>

### summarizingAll

> **summarizingAll**: `boolean`

### summarizingPath

> **summarizingPath**: `string` \| `null`

### uploadAndAttachFiles

> **uploadAndAttachFiles**: (`files`) => `Promise`\<`void`\>

#### Parameters

##### files

`File`[]

#### Returns

`Promise`\<`void`\>
