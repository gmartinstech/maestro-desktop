[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/components/Onboarding/hooks/useOnboardingProgress](../README.md) / useOnboardingProgress

# Function: useOnboardingProgress()

> **useOnboardingProgress**(): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/hooks/useOnboardingProgress.ts:13](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/hooks/useOnboardingProgress.ts#L13)

## Returns

### clearJustCompleted

> **clearJustCompleted**: () => `object`

#### Returns

`object`

##### payload

> **payload**: `undefined`

##### type

> **type**: `"onboardingProgress/clearJustCompleted"`

### completedSteps

> **completedSteps**: `string`[]

### currentStepId

> **currentStepId**: `string` \| `null`

### disableSkipIf

> **disableSkipIf**: `boolean`

True after explicit restart-from-Settings; suppresses skipIf so the tour feels fresh.

### dismissedAt

> **dismissedAt**: `number` \| `null`

### initialized

> **initialized**: `boolean`

Set on first-launch detection so we don't re-init defaults on every mount.

### justCompletedStepId

> **justCompletedStepId**: `string` \| `null`

Brief celebration marker; clearJustCompleted clears it ~1.5s after the animation.

### markCompleted

> **markCompleted**: (`id`) => `object`

#### Parameters

##### id

`string`

#### Returns

`object`

##### payload

> **payload**: `string`

##### type

> **type**: `"onboardingProgress/markStepCompleted"`

### panelMode

> **panelMode**: [`PanelMode`](../../../../../../shared/state/onboardingProgressSlice/type-aliases/PanelMode.md)

### perStepState

> **perStepState**: `Record`\<`string`, [`PerStepState`](../../../../../../shared/state/onboardingProgressSlice/interfaces/PerStepState.md)\>

### recordMultiChoice

> **recordMultiChoice**: (`stepId`, `opId`, `answerId`) => `object`

#### Parameters

##### stepId

`string`

##### opId

`string`

##### answerId

`string`

#### Returns

`object`

##### payload

> **payload**: `object`

###### payload.answerId

> **answerId**: `string`

###### payload.opId

> **opId**: `string`

###### payload.stepId

> **stepId**: `string`

##### type

> **type**: `"onboardingProgress/recordMultiChoice"`

### resetTour

> **resetTour**: () => `object`

#### Returns

`object`

##### payload

> **payload**: `undefined`

##### type

> **type**: `"onboardingProgress/resetTour"`

### running

> **running**: `boolean`

Runtime-only; true while AC is executing a step's ops.

### setCurrentStep

> **setCurrentStep**: (`id`) => `object`

#### Parameters

##### id

`string` \| `null`

#### Returns

`object`

##### payload

> **payload**: `string` \| `null`

##### type

> **type**: `"onboardingProgress/setCurrentStep"`

### setPanelMode

> **setPanelMode**: (`m`) => `object`

#### Parameters

##### m

[`PanelMode`](../../../../../../shared/state/onboardingProgressSlice/type-aliases/PanelMode.md)

#### Returns

`object`

##### payload

> **payload**: [`PanelMode`](../../../../../../shared/state/onboardingProgressSlice/type-aliases/PanelMode.md)

##### type

> **type**: `"onboardingProgress/setPanelMode"`

### setRunning

> **setRunning**: (`running`) => `object`

#### Parameters

##### running

`boolean`

#### Returns

`object`

##### payload

> **payload**: `boolean`

##### type

> **type**: `"onboardingProgress/setRunning"`

### startedAt

> **startedAt**: `number`

### version

> **version**: `2`
