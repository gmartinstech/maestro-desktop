[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/interaction/useCardDrag](../README.md) / useCardDrag

# Function: useCardDrag()

> **useCardDrag**(`__namedParameters`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/interaction/useCardDrag.ts:22](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/interaction/useCardDrag.ts#L22)

## Parameters

### \_\_namedParameters

`UseCardDragArgs`

## Returns

`object`

### handleCardDragEnd

> **handleCardDragEnd**: (`dx`, `dy`, `didDrag`) => `void`

#### Parameters

##### dx

`number`

##### dy

`number`

##### didDrag

`boolean`

#### Returns

`void`

### handleCardDragMove

> **handleCardDragMove**: (`dx`, `dy`, `mouseX?`, `mouseY?`) => `void`

#### Parameters

##### dx

`number`

##### dy

`number`

##### mouseX?

`number`

##### mouseY?

`number`

#### Returns

`void`

### handleCardDragStart

> **handleCardDragStart**: (`id`, `_type`) => `void`

#### Parameters

##### id

`string`

##### \_type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

#### Returns

`void`

### liveDragInfo

> **liveDragInfo**: \{ `cardId`: `string`; `dx`: `number`; `dy`: `number`; \} \| `null`

### multiDragDelta

> **multiDragDelta**: \{ `dx`: `number`; `dy`: `number`; \} \| `null`
