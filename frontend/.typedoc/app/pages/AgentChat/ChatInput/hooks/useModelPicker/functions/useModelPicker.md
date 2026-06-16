[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/AgentChat/ChatInput/hooks/useModelPicker](../README.md) / useModelPicker

# Function: useModelPicker()

> **useModelPicker**(`allModelOptions`, `model`, `modelAnchor`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/hooks/useModelPicker.ts:23](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/hooks/useModelPicker.ts#L23)

## Parameters

### allModelOptions

`AllModelOptions`

### model

`string`

### modelAnchor

`HTMLElement` \| `null`

## Returns

`object`

### anyFilterActive

> **anyFilterActive**: `boolean`

### capFilters

> **capFilters**: `CapFilters`

### collapsedGroups

> **collapsedGroups**: `Record`\<`string`, `boolean`\>

### costIdx

> **costIdx**: `number`

### ctxIdx

> **ctxIdx**: `number`

### filteredModelGroups

> **filteredModelGroups**: `Record`\<`string`, `any`[]\>

### filtersExpanded

> **filtersExpanded**: `boolean`

### modelSearch

> **modelSearch**: `string`

### modelSearchRef

> **modelSearchRef**: `MutableRefObject`\<`HTMLInputElement` \| `null`\>

### pickerSummary

> **pickerSummary**: `object`

#### pickerSummary.apiKey

> **apiKey**: `number`

#### pickerSummary.free

> **free**: `number`

#### pickerSummary.longContext

> **longContext**: `number`

#### pickerSummary.paid

> **paid**: `number`

#### pickerSummary.reasoning

> **reasoning**: `number`

#### pickerSummary.subscription

> **subscription**: `number`

#### pickerSummary.total

> **total**: `number`

### probeResult

> **probeResult**: \{ `error?`: `string`; `latency_ms?`: `number`; `ok`: `boolean`; `value`: `string`; \} \| `null`

### pushRecentModel

> **pushRecentModel**: (`value`) => `void`

#### Parameters

##### value

`string`

#### Returns

`void`

### pushRecentSearch

> **pushRecentSearch**: (`q`) => `void`

#### Parameters

##### q

`string`

#### Returns

`void`

### recentMaterialised

> **recentMaterialised**: `any`[]

### recentModels

> **recentModels**: `string`[]

### recentSearches

> **recentSearches**: `string`[]

### setCapFilters

> **setCapFilters**: `Dispatch`\<`SetStateAction`\<`CapFilters`\>\>

### setCostIdx

> **setCostIdx**: `Dispatch`\<`SetStateAction`\<`number`\>\>

### setCtxIdx

> **setCtxIdx**: `Dispatch`\<`SetStateAction`\<`number`\>\>

### setModelSearch

> **setModelSearch**: `Dispatch`\<`SetStateAction`\<`string`\>\>

### showRecents

> **showRecents**: `boolean`

### toggleFilters

> **toggleFilters**: () => `void`

#### Returns

`void`

### toggleGroupCollapse

> **toggleGroupCollapse**: (`prov`, `currentlyCollapsed`) => `void`

#### Parameters

##### prov

`string`

##### currentlyCollapsed

`boolean`

#### Returns

`void`
