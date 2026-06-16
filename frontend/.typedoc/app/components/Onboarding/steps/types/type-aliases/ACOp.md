[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/components/Onboarding/steps/types](../README.md) / ACOp

# Type Alias: ACOp

> **ACOp** = \{ `kind`: `"move_to"`; `offset?`: \{ `x`: `number`; `y`: `number`; \}; `target`: [`Selector`](Selector.md); \} \| \{ `cta?`: `string`; `kind`: `"popup"`; `text`: `string`; \} \| \{ `kind`: `"multi_choice"`; `opId`: `string`; `options`: [`ACMultiChoiceOption`](ACMultiChoiceOption.md)[]; `question`: `string`; \} \| \{ `durationMs?`: `number`; `kind`: `"highlight_section"`; `popup?`: `string`; `target`: [`Selector`](Selector.md); \} \| \{ `kind`: `"type_into"`; `speedMs?`: `number`; `target`: [`Selector`](Selector.md); `text`: `string` \| ((`state`) => `string`); \} \| \{ `kind`: `"click"`; `simulate?`: `boolean`; `target`: [`Selector`](Selector.md); \} \| \{ `kind`: `"drag_select"`; `target`: [`Selector`](Selector.md); \} \| \{ `condition`: [`AdvanceCondition`](AdvanceCondition.md); `hint?`: `string`; `kind`: `"wait_user"`; `timeoutMs?`: `number`; \} \| \{ `kind`: `"delay"`; `ms`: `number`; \} \| \{ `css`: `string`; `kind`: `"wait_for_dom"`; `timeoutMs?`: `number`; \} \| \{ `kind`: `"outro"`; \}

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/components/Onboarding/steps/types.ts:15](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/components/Onboarding/steps/types.ts#L15)

## Union Members

### Type Literal

\{ `kind`: `"move_to"`; `offset?`: \{ `x`: `number`; `y`: `number`; \}; `target`: [`Selector`](Selector.md); \}

***

### Type Literal

\{ `cta?`: `string`; `kind`: `"popup"`; `text`: `string`; \}

***

### Type Literal

\{ `kind`: `"multi_choice"`; `opId`: `string`; `options`: [`ACMultiChoiceOption`](ACMultiChoiceOption.md)[]; `question`: `string`; \}

***

### Type Literal

\{ `durationMs?`: `number`; `kind`: `"highlight_section"`; `popup?`: `string`; `target`: [`Selector`](Selector.md); \}

***

### Type Literal

\{ `kind`: `"type_into"`; `speedMs?`: `number`; `target`: [`Selector`](Selector.md); `text`: `string` \| ((`state`) => `string`); \}

#### kind

> **kind**: `"type_into"`

#### speedMs?

> `optional` **speedMs?**: `number`

#### target

> **target**: [`Selector`](Selector.md)

#### text

> **text**: `string` \| ((`state`) => `string`)

Static string or function evaluated once at op-execution; not reactive to subsequent state.

***

### Type Literal

\{ `kind`: `"click"`; `simulate?`: `boolean`; `target`: [`Selector`](Selector.md); \}

***

### Type Literal

\{ `kind`: `"drag_select"`; `target`: [`Selector`](Selector.md); \}

***

### Type Literal

\{ `condition`: [`AdvanceCondition`](AdvanceCondition.md); `hint?`: `string`; `kind`: `"wait_user"`; `timeoutMs?`: `number`; \}

***

### Type Literal

\{ `kind`: `"delay"`; `ms`: `number`; \}

***

### Type Literal

\{ `css`: `string`; `kind`: `"wait_for_dom"`; `timeoutMs?`: `number`; \}

Poll a raw CSS selector until it mounts, up to timeoutMs (step 8 uses for App Builder chat-input).

***

### Type Literal

\{ `kind`: `"outro"`; \}
