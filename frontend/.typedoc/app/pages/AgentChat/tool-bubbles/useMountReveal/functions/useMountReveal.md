[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/AgentChat/tool-bubbles/useMountReveal](../README.md) / useMountReveal

# Function: useMountReveal()

> **useMountReveal**(`durationMs?`, `travelPx?`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/tool-bubbles/useMountReveal.ts:20](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/tool-bubbles/useMountReveal.ts#L20)

Reliable mount-reveal for elements that should slide+fade in once when they
first appear. Returns an sx fragment to spread onto the element.

Why this instead of a CSS `@keyframes ... animation`: a mount-time keyframe
fires at most once and silently no-ops in several real cases here (Emotion
injects the keyframe in the same pass the element mounts; the tool bubble
briefly exists as its streaming twin first; a same-frame re-render with the
same animation-name won't restart it). That's why tool bubbles read as
"appears out of nowhere" while the JS-driven streamed text feels smooth.

This is the same robustness class as the text reveal: render hidden, then on
the NEXT frame flip to shown with a CSS *transition*. A transition always
runs when the property value changes, and the rAF flip guarantees a change
after the first paint, so the reveal can't be skipped. Transform+opacity only,
so it rides the compositor and never nudges layout or scroll.

## Parameters

### durationMs?

`number` = `280`

### travelPx?

`number` = `10`

## Returns

`object`

### opacity

> `readonly` **opacity**: `0` \| `1`

### transform

> `readonly` **transform**: `string`

### transition

> `readonly` **transition**: `` `opacity ${number}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${number}ms cubic-bezier(0.22, 1, 0.36, 1)` ``
