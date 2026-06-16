[**open-swarm**](../../../README.md)

***

[open-swarm](../../../README.md) / [shared/serviceClient](../README.md) / default

# Variable: default

> `const` **default**: `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/serviceClient.ts:102](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/serviceClient.ts#L102)

## Type Declaration

### getRecentActions

> **getRecentActions**: (`limit`) => `object`[]

Snapshot recent report() entries for breadcrumb context in error paths.

#### Parameters

##### limit?

`number` = `10`

#### Returns

`object`[]

### getSessionTraceState

> **getSessionTraceState**: () => `object`

#### Returns

`object`

##### appStartTs

> **appStartTs**: `number`

##### currentPage

> **currentPage**: `string`

##### lastTs

> **lastTs**: `number`

### report

> **report**: (`surface`, `action`, `props?`, `opts`) => `void`

Ship-an-event helper: same wire shape as sync(), reads as a UI surface verb in callers.

#### Parameters

##### surface

`string`

##### action

`string`

##### props?

`Record`\<`string`, `unknown`\>

##### opts?

###### immediate?

`boolean`

#### Returns

`void`

### sync

> **sync**: (`data`, `opts`) => `void`

#### Parameters

##### data?

`Record`\<`string`, `unknown`\> = `{}`

##### opts?

###### immediate?

`boolean`

#### Returns

`void`
