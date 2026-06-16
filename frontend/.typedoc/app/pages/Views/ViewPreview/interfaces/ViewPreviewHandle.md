[**open-swarm**](../../../../../README.md)

***

[open-swarm](../../../../../README.md) / [app/pages/Views/ViewPreview](../README.md) / ViewPreviewHandle

# Interface: ViewPreviewHandle

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Views/ViewPreview.tsx:40](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Views/ViewPreview.tsx#L40)

## Properties

### capture

> **capture**: () => `Promise`\<`string` \| `null`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Views/ViewPreview.tsx:43](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Views/ViewPreview.tsx#L43)

Native snapshot of the live preview as a small JPEG data URL, or null if not capturable (iframe/dev, hidden, or webview not ready).

#### Returns

`Promise`\<`string` \| `null`\>

***

### reload

> **reload**: () => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Views/ViewPreview.tsx:41](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Views/ViewPreview.tsx#L41)

#### Returns

`void`
