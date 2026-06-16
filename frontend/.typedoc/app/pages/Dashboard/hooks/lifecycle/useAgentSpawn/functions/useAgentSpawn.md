[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/lifecycle/useAgentSpawn](../README.md) / useAgentSpawn

# Function: useAgentSpawn()

> **useAgentSpawn**(`__namedParameters`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/lifecycle/useAgentSpawn.ts:43](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/lifecycle/useAgentSpawn.ts#L43)

## Parameters

### \_\_namedParameters

`UseAgentSpawnArgs`

## Returns

`object`

### handleBranchFromCard

> **handleBranchFromCard**: (`sourceSessionId`, `newSessionId`) => `void`

#### Parameters

##### sourceSessionId

`string`

##### newSessionId

`string`

#### Returns

`void`

### handleNewAgent

> **handleNewAgent**: () => `void`

#### Returns

`void`

### handleToolbarCancel

> **handleToolbarCancel**: () => `void`

#### Returns

`void`

### handleToolbarSend

> **handleToolbarSend**: (`prompt`, `mode`, `model`, `images?`, `contextPaths?`, `forcedTools?`, `attachedSkills?`, `selectedBrowserIds?`) => `void`

#### Parameters

##### prompt

`string`

##### mode

`string`

##### model

`string`

##### images?

`object`[]

##### contextPaths?

[`ContextPath`](../../../../../../components/editor/DirectoryBrowser/interfaces/ContextPath.md)[]

##### forcedTools?

`string`[]

##### attachedSkills?

`object`[]

##### selectedBrowserIds?

`string`[]

#### Returns

`void`
