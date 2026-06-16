[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/onboardingProgressSlice](../README.md) / OnboardingProgressState

# Interface: OnboardingProgressState

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:17](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L17)

## Properties

### completedSteps

> **completedSteps**: `string`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:20](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L20)

***

### currentStepId

> **currentStepId**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:21](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L21)

***

### disableSkipIf

> **disableSkipIf**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:32](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L32)

True after explicit restart-from-Settings; suppresses skipIf so the tour feels fresh.

***

### dismissedAt

> **dismissedAt**: `number` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:23](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L23)

***

### initialized

> **initialized**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:28](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L28)

Set on first-launch detection so we don't re-init defaults on every mount.

***

### justCompletedStepId

> **justCompletedStepId**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:30](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L30)

Brief celebration marker; clearJustCompleted clears it ~1.5s after the animation.

***

### panelMode

> **panelMode**: [`PanelMode`](../type-aliases/PanelMode.md)

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:22](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L22)

***

### perStepState

> **perStepState**: `Record`\<`string`, [`PerStepState`](PerStepState.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:24](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L24)

***

### running

> **running**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:26](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L26)

Runtime-only; true while AC is executing a step's ops.

***

### startedAt

> **startedAt**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:19](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L19)

***

### version

> **version**: `2`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:18](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L18)
