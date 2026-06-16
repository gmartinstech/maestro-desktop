[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/AgentChat/ChatInput/hooks/useEditorHandlers](../README.md) / useEditorHandlers

# Function: useEditorHandlers()

> **useEditorHandlers**(`p`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/hooks/useEditorHandlers.ts:59](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/hooks/useEditorHandlers.ts#L59)

## Parameters

### p

`Params`

## Returns

`object`

### handleDragLeave

> **handleDragLeave**: (`e`) => `void`

#### Parameters

##### e

`DragEvent`

#### Returns

`void`

### handleDragOver

> **handleDragOver**: (`e`) => `void`

#### Parameters

##### e

`DragEvent`

#### Returns

`void`

### handleDrop

> **handleDrop**: (`e`) => `void`

#### Parameters

##### e

`DragEvent`

#### Returns

`void`

### handleEditorClick

> **handleEditorClick**: () => `void`

#### Returns

`void`

### handleInput

> **handleInput**: () => `void`

#### Returns

`void`

### handleKeyDown

> **handleKeyDown**: (`e`) => `void`

#### Parameters

##### e

`KeyboardEvent`

#### Returns

`void`

### handlePaste

> **handlePaste**: (`e`) => `void`

#### Parameters

##### e

`ClipboardEvent`

#### Returns

`void`

### handlePickerSelect

> **handlePickerSelect**: (`item`) => `void`

#### Parameters

##### item

[`CommandPickerItem`](../../../../../../components/editor/CommandPicker/interfaces/CommandPickerItem.md)

#### Returns

`void`

### isDragOver

> **isDragOver**: `boolean`

### picker

> **picker**: [`TriggerState`](../../../../../../components/editor/richEditorUtils/interfaces/TriggerState.md)

### setPicker

> **setPicker**: `Dispatch`\<`SetStateAction`\<[`TriggerState`](../../../../../../components/editor/richEditorUtils/interfaces/TriggerState.md)\>\>

### updateHasContent

> **updateHasContent**: () => `void`

#### Returns

`void`
