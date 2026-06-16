[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/Tools/hooks/useToolsActions](../README.md) / useToolsActions

# Function: useToolsActions()

> **useToolsActions**(`__namedParameters`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Tools/hooks/useToolsActions.ts:27](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Tools/hooks/useToolsActions.ts#L27)

## Parameters

### \_\_namedParameters

`ToolsActionsDeps`

## Returns

`object`

### credDialogIntegration

> **credDialogIntegration**: [`Integration`](../../../integrations/interfaces/Integration.md) \| `null`

### credDialogOpen

> **credDialogOpen**: `boolean`

### credDialogSaving

> **credDialogSaving**: `boolean`

### credDialogValues

> **credDialogValues**: `Record`\<`string`, `string`\>

### deviceCode

> **deviceCode**: `string`

### deviceCodeDialogOpen

> **deviceCodeDialogOpen**: `boolean`

### deviceCodeStatus

> **deviceCodeStatus**: `"loading"` \| `"error"` \| `"awaiting"` \| `"connected"`

### deviceCodeUrl

> **deviceCodeUrl**: `string`

### dialogOpen

> **dialogOpen**: `boolean`

### discovering

> **discovering**: `boolean`

### editingId

> **editingId**: `string` \| `null`

### expandedSchema

> **expandedSchema**: `string` \| `null`

### expandedServer

> **expandedServer**: `string` \| `null`

### expandedServices

> **expandedServices**: `Record`\<`string`, `boolean`\>

### expandedToolId

> **expandedToolId**: `string` \| `null`

### form

> **form**: [`ToolForm`](../../../toolsHelpers/interfaces/ToolForm.md)

### handleBuiltinCategoryPermissionChange

> **handleBuiltinCategoryPermissionChange**: (`toolNames`, `policy`) => `Promise`\<`void`\>

#### Parameters

##### toolNames

`string`[]

##### policy

`string`

#### Returns

`Promise`\<`void`\>

### handleBuiltinPermissionChange

> **handleBuiltinPermissionChange**: (`toolName`, `policy`) => `Promise`\<`void`\>

#### Parameters

##### toolName

`string`

##### policy

`string`

#### Returns

`Promise`\<`void`\>

### handleBulkReadOnly

> **handleBulkReadOnly**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleCredentialsSave

> **handleCredentialsSave**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### handleDelete

> **handleDelete**: (`id`) => `Promise`\<`void`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

### handleDeviceCodeConnect

> **handleDeviceCodeConnect**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleDisconnectIntegration

> **handleDisconnectIntegration**: (`toolId`, `integration`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

##### integration

[`Integration`](../../../integrations/interfaces/Integration.md)

#### Returns

`Promise`\<`void`\>

### handleDiscover

> **handleDiscover**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleEditInstall

> **handleEditInstall**: (`srv`) => `void`

#### Parameters

##### srv

[`McpServer`](../../../../../../shared/state/mcpRegistrySlice/interfaces/McpServer.md)

#### Returns

`void`

### handleGroupPermissionChange

> **handleGroupPermissionChange**: (`toolId`, `names`, `policy`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

##### names

`string`[]

##### policy

`string`

#### Returns

`Promise`\<`void`\>

### handleInstall

> **handleInstall**: (`srv`) => `Promise`\<`void`\>

#### Parameters

##### srv

[`McpServer`](../../../../../../shared/state/mcpRegistrySlice/interfaces/McpServer.md)

#### Returns

`Promise`\<`void`\>

### handleIntegrationToggle

> **handleIntegrationToggle**: (`integration`) => `Promise`\<`void`\>

#### Parameters

##### integration

[`Integration`](../../../integrations/interfaces/Integration.md)

#### Returns

`Promise`\<`void`\>

### handleLoadMore

> **handleLoadMore**: () => `void`

#### Returns

`void`

### handleM365Disconnect

> **handleM365Disconnect**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleMcpConfigSave

> **handleMcpConfigSave**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### handleOAuthConnect

> **handleOAuthConnect**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handlePermissionChange

> **handlePermissionChange**: (`toolId`, `toolName`, `policy`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

##### toolName

`string`

##### policy

`string`

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

### handleResetPermissions

> **handleResetPermissions**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleSave

> **handleSave**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### handleSectionEnabledChange

> **handleSectionEnabledChange**: (`tools`, `enabled`) => `Promise`\<`void`\>

#### Parameters

##### tools

[`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

##### enabled

`boolean`

#### Returns

`Promise`\<`void`\>

### handleSlackAutoConnect

> **handleSlackAutoConnect**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### integrationLoading

> **integrationLoading**: `Record`\<`string`, `boolean`\>

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

### openCreate

> **openCreate**: () => `void`

#### Returns

`void`

### openCredentialsDialog

> **openCredentialsDialog**: (`toolId`, `integration`) => `void`

#### Parameters

##### toolId

`string`

##### integration

[`Integration`](../../../integrations/interfaces/Integration.md)

#### Returns

`void`

### openEdit

> **openEdit**: (`tool`) => `void`

#### Parameters

##### tool

[`ToolDefinition`](../../../../../../shared/state/toolsSlice/interfaces/ToolDefinition.md)

#### Returns

`void`

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

### setCredDialogOpen

> **setCredDialogOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setCredDialogValues

> **setCredDialogValues**: `Dispatch`\<`SetStateAction`\<`Record`\<`string`, `string`\>\>\>

### setDeviceCodeDialogOpen

> **setDeviceCodeDialogOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setDialogOpen

> **setDialogOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setEditingId

> **setEditingId**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setExpandedSchema

> **setExpandedSchema**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setExpandedServer

> **setExpandedServer**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setExpandedServices

> **setExpandedServices**: `Dispatch`\<`SetStateAction`\<`Record`\<`string`, `boolean`\>\>\>

### setExpandedToolId

> **setExpandedToolId**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setForm

> **setForm**: `Dispatch`\<`SetStateAction`\<[`ToolForm`](../../../toolsHelpers/interfaces/ToolForm.md)\>\>

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

### setSnackbar

> **setSnackbar**: `Dispatch`\<`SetStateAction`\<`Snackbar`\>\>

### snackbar

> **snackbar**: `Snackbar`
