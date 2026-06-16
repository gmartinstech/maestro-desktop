[**open-swarm**](../../../../../README.md)

***

[open-swarm](../../../../../README.md) / [app/components/Onboarding/selectors](../README.md) / waitForSelector

# Function: waitForSelector()

> **waitForSelector**(`target`, `timeoutMs?`): `Promise`\<`HTMLElement`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/selectors.ts:133](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/selectors.ts#L133)

Resolve when target mounts; 15s default to ride out heavy main-thread load on /apps/new.

## Parameters

### target

`string`

### timeoutMs?

`number` = `15000`

## Returns

`Promise`\<`HTMLElement`\>
