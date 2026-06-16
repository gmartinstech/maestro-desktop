[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/components/Onboarding/ac/acRuntime](../README.md) / RunStepArgs

# Interface: RunStepArgs

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:69](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L69)

## Properties

### ac

> **ac**: [`AgenticCursorHandle`](../../AgenticCursor/interfaces/AgenticCursorHandle.md)

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:72](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L72)

***

### accentColor

> **accentColor**: `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:74](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L74)

***

### findStep

> **findStep**: (`id`) => [`OnboardingStep`](../../../steps/types/interfaces/OnboardingStep.md) \| `undefined`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:76](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L76)

#### Parameters

##### id

`string`

#### Returns

[`OnboardingStep`](../../../steps/types/interfaces/OnboardingStep.md) \| `undefined`

***

### isDependencySatisfied?

> `optional` **isDependencySatisfied?**: (`depId`) => `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:77](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L77)

#### Parameters

##### depId

`string`

#### Returns

`boolean`

***

### signal

> **signal**: `AbortSignal`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:75](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L75)

***

### spawnPoint

> **spawnPoint**: `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:71](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L71)

#### x

> **x**: `number`

#### y

> **y**: `number`

***

### step

> **step**: [`OnboardingStep`](../../../steps/types/interfaces/OnboardingStep.md)

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:70](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L70)

***

### store

> **store**: `Store`\<\{ `agents`: `AgentsState`; `dashboardLayout`: [`DashboardLayoutState`](../../../../../../shared/state/dashboardLayoutSlice/interfaces/DashboardLayoutState.md); `dashboards`: `DashboardsState`; `interaction`: `InteractionState`; `mcpRegistry`: `McpRegistryState`; `models`: `ModelsState`; `modes`: `ModesState`; `onboardingProgress`: [`OnboardingProgressState`](../../../../../../shared/state/onboardingProgressSlice/interfaces/OnboardingProgressState.md); `outputs`: `OutputsState`; `settings`: `SettingsState`; `skillRegistry`: `SkillRegistryState`; `skills`: `SkillsState`; `streaming`: `StreamingState`; `subscriptions`: [`SubscriptionsState`](../../../../../../shared/state/subscriptionsSlice/interfaces/SubscriptionsState.md); `tempState`: `TempState`; `tools`: `ToolsState`; `update`: `UpdateState`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/ac/acRuntime.ts:73](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/ac/acRuntime.ts#L73)
