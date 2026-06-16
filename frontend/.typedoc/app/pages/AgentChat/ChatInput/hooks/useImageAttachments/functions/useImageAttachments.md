[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/AgentChat/ChatInput/hooks/useImageAttachments](../README.md) / useImageAttachments

# Function: useImageAttachments()

> **useImageAttachments**(): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/ChatInput/hooks/useImageAttachments.ts:4](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/ChatInput/hooks/useImageAttachments.ts#L4)

## Returns

`object`

### addImageFiles

> **addImageFiles**: (`files`) => `void`

#### Parameters

##### files

`File`[] \| `FileList`

#### Returns

`void`

### images

> **images**: [`AttachedImage`](../../../types/interfaces/AttachedImage.md)[]

### lightboxSrc

> **lightboxSrc**: `string` \| `null`

### removeImage

> **removeImage**: (`idx`) => `void`

#### Parameters

##### idx

`number`

#### Returns

`void`

### setImages

> **setImages**: `Dispatch`\<`SetStateAction`\<[`AttachedImage`](../../../types/interfaces/AttachedImage.md)[]\>\>

### setLightboxSrc

> **setLightboxSrc**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>
