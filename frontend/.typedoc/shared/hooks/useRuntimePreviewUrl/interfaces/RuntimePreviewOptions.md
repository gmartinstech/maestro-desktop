[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/hooks/useRuntimePreviewUrl](../README.md) / RuntimePreviewOptions

# Interface: RuntimePreviewOptions

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/hooks/useRuntimePreviewUrl.ts:19](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/hooks/useRuntimePreviewUrl.ts#L19)

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/hooks/useRuntimePreviewUrl.ts:22](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/hooks/useRuntimePreviewUrl.ts#L22)

Gate the spawn so callers can defer paying runtime cost until preview is wanted.

***

### onLog?

> `optional` **onLog?**: (`line`) => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/hooks/useRuntimePreviewUrl.ts:23](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/hooks/useRuntimePreviewUrl.ts#L23)

#### Parameters

##### line

[`RuntimeLogLine`](RuntimeLogLine.md)

#### Returns

`void`

***

### workspaceId

> **workspaceId**: `string` \| `null` \| `undefined`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/hooks/useRuntimePreviewUrl.ts:20](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/hooks/useRuntimePreviewUrl.ts#L20)
