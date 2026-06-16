[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/components/Onboarding/steps/skipPredicates](../README.md) / hasPdfSkillInstalled

# Function: hasPdfSkillInstalled()

> **hasPdfSkillInstalled**(`s`): `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/skipPredicates.ts:72](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/skipPredicates.ts#L72)

True if PDF skill installed (id/name/command); step 7 uses this so other skills don't auto-skip.

## Parameters

### s

#### agents

`AgentsState` = `agentsReducer`

#### dashboardLayout

[`DashboardLayoutState`](../../../../../../shared/state/dashboardLayoutSlice/interfaces/DashboardLayoutState.md) = `dashboardLayoutReducer`

#### dashboards

`DashboardsState` = `dashboardsReducer`

#### interaction

`InteractionState` = `interactionReducer`

#### mcpRegistry

`McpRegistryState` = `mcpRegistryReducer`

#### models

`ModelsState` = `modelsReducer`

#### modes

`ModesState` = `modesReducer`

#### onboardingProgress

[`OnboardingProgressState`](../../../../../../shared/state/onboardingProgressSlice/interfaces/OnboardingProgressState.md) = `onboardingProgressReducer`

#### outputs

`OutputsState` = `outputsReducer`

#### settings

`SettingsState` = `settingsReducer`

#### skillRegistry

`SkillRegistryState` = `skillRegistryReducer`

#### skills

`SkillsState` = `skillsReducer`

#### streaming

`StreamingState` = `streamingReducer`

#### subscriptions

[`SubscriptionsState`](../../../../../../shared/state/subscriptionsSlice/interfaces/SubscriptionsState.md) = `subscriptionsReducer`

#### tempState

`TempState` = `tempStateReducer`

#### tools

`ToolsState` = `toolsReducer`

#### update

`UpdateState` = `updateReducer`

## Returns

`boolean`
