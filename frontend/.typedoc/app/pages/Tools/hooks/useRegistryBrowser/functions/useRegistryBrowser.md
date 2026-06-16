[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/Tools/hooks/useRegistryBrowser](../README.md) / useRegistryBrowser

# Function: useRegistryBrowser()

> **useRegistryBrowser**(`__namedParameters`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Tools/hooks/useRegistryBrowser.ts:19](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Tools/hooks/useRegistryBrowser.ts#L19)

## Parameters

### \_\_namedParameters

`Deps`

## Returns

`object`

### expandedServer

> **expandedServer**: `string` \| `null`

### handleEditInstall

> **handleEditInstall**: (`srv`) => `void`

#### Parameters

##### srv

[`McpServer`](../../../../../../shared/state/mcpRegistrySlice/interfaces/McpServer.md)

#### Returns

`void`

### handleInstall

> **handleInstall**: (`srv`) => `Promise`\<`void`\>

#### Parameters

##### srv

[`McpServer`](../../../../../../shared/state/mcpRegistrySlice/interfaces/McpServer.md)

#### Returns

`Promise`\<`void`\>

### handleLoadMore

> **handleLoadMore**: () => `void`

#### Returns

`void`

### handleMcpConfigSave

> **handleMcpConfigSave**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### handleRegSearch

> **handleRegSearch**: (`q`, `sort?`, `source?`) => `void`

#### Parameters

##### q

`string`

##### sort?

`"name"` \| `"stars"`

##### source?

`RegSource`

#### Returns

`void`

### handleRegSort

> **handleRegSort**: (`sort`) => `void`

#### Parameters

##### sort

`"name"` \| `"stars"`

#### Returns

`void`

### handleRegSourceFilter

> **handleRegSourceFilter**: (`_`, `val`) => `void`

#### Parameters

##### \_

`MouseEvent`\<`HTMLElement`\>

##### val

`RegSource`

#### Returns

`void`

### mcpAuthType

> **mcpAuthType**: `"none"` \| `"env_vars"`

### mcpConfigError

> **mcpConfigError**: `string`

### mcpConfigJson

> **mcpConfigJson**: `string`

### mcpConfigOpen

> **mcpConfigOpen**: `boolean`

### mcpConfigServer

> **mcpConfigServer**: [`McpServer`](../../../../../../shared/state/mcpRegistrySlice/interfaces/McpServer.md) \| `null`

### mcpCredentials

> **mcpCredentials**: `Record`\<`string`, `string`\>

### openRegistryBrowser

> **openRegistryBrowser**: () => `void`

#### Returns

`void`

### registryOpen

> **registryOpen**: `boolean`

### regQuery

> **regQuery**: `string`

### regSort

> **regSort**: `"name"` \| `"stars"`

### regSource

> **regSource**: `RegSource`

### setExpandedServer

> **setExpandedServer**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setMcpAuthType

> **setMcpAuthType**: `Dispatch`\<`SetStateAction`\<`"none"` \| `"env_vars"`\>\>

### setMcpConfigError

> **setMcpConfigError**: `Dispatch`\<`SetStateAction`\<`string`\>\>

### setMcpConfigJson

> **setMcpConfigJson**: `Dispatch`\<`SetStateAction`\<`string`\>\>

### setMcpConfigOpen

> **setMcpConfigOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setMcpCredentials

> **setMcpCredentials**: `Dispatch`\<`SetStateAction`\<`Record`\<`string`, `string`\>\>\>

### setRegistryOpen

> **setRegistryOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>
