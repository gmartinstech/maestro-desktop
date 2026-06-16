[**open-swarm**](../../../README.md)

***

[open-swarm](../../../README.md) / [shared/browserRegistry](../README.md) / ElectronNativeImage

# Interface: ElectronNativeImage

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:3](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L3)

## Properties

### getSize

> **getSize**: () => `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:8](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L8)

#### Returns

`object`

##### height

> **height**: `number`

##### width

> **width**: `number`

***

### isEmpty

> **isEmpty**: () => `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:7](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L7)

#### Returns

`boolean`

***

### resize

> **resize**: (`options`) => `ElectronNativeImage`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:9](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L9)

#### Parameters

##### options

###### height?

`number`

###### quality?

`"good"` \| `"better"` \| `"best"`

###### width?

`number`

#### Returns

`ElectronNativeImage`

***

### toDataURL

> **toDataURL**: () => `string`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:4](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L4)

#### Returns

`string`

***

### toJPEG

> **toJPEG**: (`quality`) => `Buffer`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:6](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L6)

#### Parameters

##### quality

`number`

#### Returns

`Buffer`

***

### toPNG

> **toPNG**: () => `Buffer`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/browserRegistry.ts:5](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/browserRegistry.ts#L5)

#### Returns

`Buffer`
