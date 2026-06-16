[**open-swarm**](../../../README.md)

***

[open-swarm](../../../README.md) / [shared/useBrowserActivity](../README.md) / BrowserActivityState

# Interface: BrowserActivityState

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:9](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L9)

## Properties

### action

> **action**: [`BrowserAction`](../../browserCommandHandler/type-aliases/BrowserAction.md) \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:11](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L11)

***

### actionSeq

> **actionSeq**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:16](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L16)

Increments per new action; use as React key to restart CSS animations.

***

### active

> **active**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:10](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L10)

***

### coords

> **coords**: \{ `xPercent`: `number`; `yPercent`: `number`; \} \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:18](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L18)

Viewport-relative click coords (0-1) for positioning the click ripple.

***

### detail

> **detail**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:12](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L12)

***

### lastAction

> **lastAction**: [`BrowserAction`](../../browserCommandHandler/type-aliases/BrowserAction.md) \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/useBrowserActivity.ts:14](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/useBrowserActivity.ts#L14)

Action that just completed; stays briefly for exit animations.
