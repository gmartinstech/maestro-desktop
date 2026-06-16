[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/components/Onboarding/steps/types](../README.md) / OnboardingStep

# Interface: OnboardingStep

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:47](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L47)

## Properties

### dependsOn?

> `optional` **dependsOn?**: [`StepDependency`](StepDependency.md)[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:58](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L58)

***

### description

> **description**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:53](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L53)

***

### id

> **id**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:48](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L48)

***

### index

> **index**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:51](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L51)

1..N (currently 1..8).

***

### ops

> **ops**: [`ACOp`](../type-aliases/ACOp.md)[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:57](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L57)

***

### requiresDashboard?

> `optional` **requiresDashboard?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:62](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L62)

True when ops target dashboard-toolbar elements; runtime auto-prepends a click-into-dashboard hop.

***

### skipIf?

> `optional` **skipIf?**: (`state`) => `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:60](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L60)

Mark a step already-done at launch / Show me click without running its flow.

#### Parameters

##### state

###### agents

`AgentsState` = `agentsReducer`

###### dashboardLayout

[`DashboardLayoutState`](../../../../../../shared/state/dashboardLayoutSlice/interfaces/DashboardLayoutState.md) = `dashboardLayoutReducer`

###### dashboards

`DashboardsState` = `dashboardsReducer`

###### interaction

`InteractionState` = `interactionReducer`

###### mcpRegistry

`McpRegistryState` = `mcpRegistryReducer`

###### models

`ModelsState` = `modelsReducer`

###### modes

`ModesState` = `modesReducer`

###### onboardingProgress

[`OnboardingProgressState`](../../../../../../shared/state/onboardingProgressSlice/interfaces/OnboardingProgressState.md) = `onboardingProgressReducer`

###### outputs

`OutputsState` = `outputsReducer`

###### settings

`SettingsState` = `settingsReducer`

###### skillRegistry

`SkillRegistryState` = `skillRegistryReducer`

###### skills

`SkillsState` = `skillsReducer`

###### streaming

`StreamingState` = `streamingReducer`

###### subscriptions

[`SubscriptionsState`](../../../../../../shared/state/subscriptionsSlice/interfaces/SubscriptionsState.md) = `subscriptionsReducer`

###### tempState

`TempState` = `tempStateReducer`

###### tools

`ToolsState` = `toolsReducer`

###### update

`UpdateState` = `updateReducer`

#### Returns

`boolean`

***

### stage

> **stage**: [`StepStage`](../type-aliases/StepStage.md)

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:49](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L49)

***

### title

> **title**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:52](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L52)

***

### videoDurationLabel?

> `optional` **videoDurationLabel?**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:56](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L56)

Shown in the panel preview chip, e.g. "0:24".

***

### videoSrc?

> `optional` **videoSrc?**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:54](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L54)
