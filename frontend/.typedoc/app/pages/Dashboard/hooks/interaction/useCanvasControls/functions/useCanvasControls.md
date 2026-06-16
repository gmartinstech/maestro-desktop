[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/interaction/useCanvasControls](../README.md) / useCanvasControls

# Function: useCanvasControls()

> **useCanvasControls**(`zoomSensitivity?`, `contentBounds?`, `enabled?`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/interaction/useCanvasControls.ts:32](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/interaction/useCanvasControls.ts#L32)

## Parameters

### zoomSensitivity?

`number` = `50`

### contentBounds?

[`ContentBounds`](../interfaces/ContentBounds.md)

### enabled?

`boolean` = `true`

## Returns

`object`

### actions

> **actions**: `object`

#### actions.animateTo

> **animateTo**: (`target`, `duration`) => `void`

##### Parameters

###### target

`CanvasState`

###### duration?

`number` = `320`

##### Returns

`void`

#### actions.cancelAnimation

> **cancelAnimation**: () => `void`

##### Returns

`void`

#### actions.fitToCards

> **fitToCards**: (`cardRects`, `maxZoom?`, `animate?`, `minZoom?`) => `void`

##### Parameters

###### cardRects

`object`[]

###### maxZoom?

`number`

###### animate?

`boolean`

###### minZoom?

`number`

##### Returns

`void`

#### actions.fitToView

> **fitToView**: () => `void`

##### Returns

`void`

#### actions.resetZoom

> **resetZoom**: () => `void`

##### Returns

`void`

#### actions.setState

> **setState**: `Dispatch`\<`SetStateAction`\<`CanvasState`\>\>

#### actions.zoomIn

> **zoomIn**: () => `void`

##### Returns

`void`

#### actions.zoomOut

> **zoomOut**: () => `void`

##### Returns

`void`

### cmdHeld

> **cmdHeld**: `boolean`

### contentRef

> **contentRef**: `RefObject`\<`HTMLDivElement`\>

### handlers

> **handlers**: `object`

#### handlers.onMouseDown

> **onMouseDown**: (`e`) => `void` = `handleMouseDown`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### handlers.onMouseMove

> **onMouseMove**: (`e`) => `void` = `handleMouseMove`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### handlers.onMouseUp

> **onMouseUp**: () => `void` = `handleMouseUp`

##### Returns

`void`

### isPanning

> **isPanning**: `boolean`

### panX

> `readonly` **panX**: `number`

### panY

> `readonly` **panY**: `number`

### spaceHeld

> **spaceHeld**: `boolean`

### viewportRef

> **viewportRef**: `RefObject`\<`HTMLDivElement`\>

### zoom

> `readonly` **zoom**: `number`
