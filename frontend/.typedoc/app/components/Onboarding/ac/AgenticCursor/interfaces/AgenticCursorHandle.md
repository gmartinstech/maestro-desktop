[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/components/Onboarding/ac/AgenticCursor](../README.md) / AgenticCursorHandle

# Interface: AgenticCursorHandle

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:17](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L17)

## Properties

### fadeIn

> **fadeIn**: (`from`) => `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:18](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L18)

#### Parameters

##### from

###### x

`number`

###### y

`number`

#### Returns

`Promise`\<`void`\>

***

### fadeOut

> **fadeOut**: (`to`) => `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:19](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L19)

#### Parameters

##### to

###### x

`number`

###### y

`number`

#### Returns

`Promise`\<`void`\>

***

### getPosition

> **getPosition**: () => `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:40](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L40)

#### Returns

`object`

##### x

> **x**: `number`

##### y

> **y**: `number`

***

### hidePopup

> **hidePopup**: () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:39](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L39)

#### Returns

`void`

***

### moveTo

> **moveTo**: (`x`, `y`, `transition?`) => `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:26](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L26)

Animated jump to (x, y). Defaults to the spring used for normal hops;
pass an override (e.g. a tween) when the cursor needs to ride alongside
a CSS-transitioned visual like the drag-select rect, where spring
overshoot would visibly desync from the rect's bottom-right corner.

#### Parameters

##### x

`number`

##### y

`number`

##### transition?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`void`\>

***

### pressClick

> **pressClick**: () => `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:31](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L31)

#### Returns

`Promise`\<`void`\>

***

### showMultiChoice

> **showMultiChoice**: (`q`, `opts`) => `Promise`\<`string`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:38](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L38)

Single-select multi-choice; resolves with the chosen option id.

#### Parameters

##### q

`string`

##### opts

[`ACMultiChoiceOption`](../../../steps/types/type-aliases/ACMultiChoiceOption.md)[]

#### Returns

`Promise`\<`string`\>

***

### showPopup

> **showPopup**: (`text`) => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:36](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L36)

Non-blocking popup above cursor; auto-clears on next physical-move op.

#### Parameters

##### text

`string`

#### Returns

`void`

***

### startTracking

> **startTracking**: (`selector`, `offset?`) => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:33](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L33)

Pin cursor to a live selector; rAF re-resolves so it follows reflows + React node swaps.

#### Parameters

##### selector

`string`

##### offset?

###### x

`number`

###### y

`number`

#### Returns

`void`

***

### stopTracking

> **stopTracking**: () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx:34](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/AgenticCursor.tsx#L34)

#### Returns

`void`
