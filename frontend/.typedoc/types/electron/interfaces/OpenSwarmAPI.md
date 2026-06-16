[**open-swarm**](../../../README.md)

***

[open-swarm](../../../README.md) / [types/electron](../README.md) / OpenSwarmAPI

# Interface: OpenSwarmAPI

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:34](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L34)

## Properties

### checkForUpdates

> **checkForUpdates**: () => `Promise`\<\{ `error?`: `string`; `success`: `boolean`; `version?`: `string`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:41](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L41)

#### Returns

`Promise`\<\{ `error?`: `string`; `success`: `boolean`; `version?`: `string`; \}\>

***

### downloadUpdate

> **downloadUpdate**: () => `Promise`\<\{ `error?`: `string`; `success`: `boolean`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:42](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L42)

#### Returns

`Promise`\<\{ `error?`: `string`; `success`: `boolean`; \}\>

***

### getAppVersion

> **getAppVersion**: () => `Promise`\<`string`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:37](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L37)

#### Returns

`Promise`\<`string`\>

***

### getBackendPort

> **getBackendPort**: () => `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:35](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L35)

#### Returns

`number`

***

### getBuildInfo

> **getBuildInfo**: () => `Promise`\<\{ `builtAt`: `string` \| `null`; `channel`: `string`; `sha`: `string`; `shortSha`: `string`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:38](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L38)

#### Returns

`Promise`\<\{ `builtAt`: `string` \| `null`; `channel`: `string`; `sha`: `string`; `shortSha`: `string`; \}\>

***

### getCrashRecoveryInfo?

> `optional` **getCrashRecoveryInfo?**: () => `Promise`\<\{ `parent_pid`: `number`; `ts`: `number`; `uptime_ms`: `number`; \} \| `null`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:40](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L40)

#### Returns

`Promise`\<\{ `parent_pid`: `number`; `ts`: `number`; `uptime_ms`: `number`; \} \| `null`\>

***

### getUpdateStatus

> **getUpdateStatus**: () => `Promise`\<\{ `error`: `string` \| `null`; `info`: `any`; `status`: `string`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:39](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L39)

#### Returns

`Promise`\<\{ `error`: `string` \| `null`; `info`: `any`; `status`: `string`; \}\>

***

### getWebviewPreloadPath

> **getWebviewPreloadPath**: () => `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:36](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L36)

#### Returns

`string`

***

### installUpdate

> **installUpdate**: () => `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:43](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L43)

#### Returns

`Promise`\<`void`\>

***

### onAuthUrl?

> `optional` **onAuthUrl?**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:51](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L51)

#### Parameters

##### cb

(`url`) => `void`

#### Returns

() => `void`

***

### onDownloadProgress

> **onDownloadProgress**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:46](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L46)

#### Parameters

##### cb

(`progress`) => `void`

#### Returns

() => `void`

***

### onOauthClaim?

> `optional` **onOauthClaim?**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:52](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L52)

#### Parameters

##### cb

(`url`) => `void`

#### Returns

() => `void`

***

### onUpdateAvailable

> **onUpdateAvailable**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:44](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L44)

#### Parameters

##### cb

(`info`) => `void`

#### Returns

() => `void`

***

### onUpdateDownloaded

> **onUpdateDownloaded**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:47](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L47)

#### Parameters

##### cb

(`info`) => `void`

#### Returns

() => `void`

***

### onUpdateError

> **onUpdateError**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:48](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L48)

#### Parameters

##### cb

(`message`) => `void`

#### Returns

() => `void`

***

### onUpdateNotAvailable

> **onUpdateNotAvailable**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:45](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L45)

#### Parameters

##### cb

(`info`) => `void`

#### Returns

() => `void`

***

### onWebviewNewWindow

> **onWebviewNewWindow**: (`cb`) => () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:49](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L49)

#### Parameters

##### cb

(`url`, `webContentsId`) => `void`

#### Returns

() => `void`

***

### openExternal

> **openExternal**: (`url`) => `Promise`\<`void`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/types/electron.d.ts:50](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/types/electron.d.ts#L50)

#### Parameters

##### url

`string`

#### Returns

`Promise`\<`void`\>
