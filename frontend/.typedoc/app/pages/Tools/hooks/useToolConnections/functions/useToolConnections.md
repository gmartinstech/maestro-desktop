[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/Tools/hooks/useToolConnections](../README.md) / useToolConnections

# Function: useToolConnections()

> **useToolConnections**(`__namedParameters`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Tools/hooks/useToolConnections.ts:24](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Tools/hooks/useToolConnections.ts#L24)

## Parameters

### \_\_namedParameters

`Deps`

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

### handleCredentialsSave

> **handleCredentialsSave**: () => `Promise`\<`void`\>

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

### handleM365Disconnect

> **handleM365Disconnect**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleOAuthConnect

> **handleOAuthConnect**: (`toolId`) => `Promise`\<`void`\>

#### Parameters

##### toolId

`string`

#### Returns

`Promise`\<`void`\>

### handleSlackAutoConnect

> **handleSlackAutoConnect**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### openCredentialsDialog

> **openCredentialsDialog**: (`toolId`, `integration`) => `void`

#### Parameters

##### toolId

`string`

##### integration

[`Integration`](../../../integrations/interfaces/Integration.md)

#### Returns

`void`

### setCredDialogOpen

> **setCredDialogOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setCredDialogValues

> **setCredDialogValues**: `Dispatch`\<`SetStateAction`\<`Record`\<`string`, `string`\>\>\>

### setDeviceCodeDialogOpen

> **setDeviceCodeDialogOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>
