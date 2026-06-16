[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/ws/WebSocketManager](../README.md) / default

# Class: default

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:88](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L88)

## Constructors

### Constructor

> **new default**(`url`, `options?`): `WebSocketManager`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:165](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L165)

#### Parameters

##### url

`string`

##### options?

`WSManagerOptions`

#### Returns

`WebSocketManager`

## Accessors

### connected

#### Get Signature

> **get** **connected**(): `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:834](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L834)

##### Returns

`boolean`

## Methods

### connect()

> **connect**(): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:197](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L197)

#### Returns

`void`

***

### disconnect()

> **disconnect**(): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:290](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L290)

#### Returns

`void`

***

### on()

> **on**(`event`, `handler`): () => `boolean` \| `undefined`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:826](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L826)

#### Parameters

##### event

`string`

##### handler

(`data`) => `void`

#### Returns

() => `boolean` \| `undefined`

***

### send()

> **send**(`event`, `data`): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:784](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L784)

#### Parameters

##### event

`string`

##### data

`Record`\<`string`, `any`\>

#### Returns

`void`

***

### sendApproval()

> **sendApproval**(`requestId`, `behavior`, `message?`): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:814](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L814)

#### Parameters

##### requestId

`string`

##### behavior

`"deny"` \| `"allow"`

##### message?

`string`

#### Returns

`void`

***

### sendMessage()

> **sendMessage**(`sessionId`, `prompt`, `opts?`): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:802](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L802)

#### Parameters

##### sessionId

`string`

##### prompt

`string`

##### opts?

###### images?

`object`[]

###### mode?

`string`

###### model?

`string`

###### provider?

`string`

#### Returns

`void`

***

### stopAgent()

> **stopAgent**(`sessionId`): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/ws/WebSocketManager.ts:822](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/ws/WebSocketManager.ts#L822)

#### Parameters

##### sessionId

`string`

#### Returns

`void`
