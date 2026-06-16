[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/Tools/hooks/useBuiltinSections](../README.md) / useBuiltinSections

# Function: useBuiltinSections()

> **useBuiltinSections**(`builtinTools`, `builtinPermissions`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Tools/hooks/useBuiltinSections.ts:15](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Tools/hooks/useBuiltinSections.ts#L15)

## Parameters

### builtinTools

[`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

### builtinPermissions

`Record`\<`string`, `string`\>

## Returns

`object`

### browserActionTools

> **browserActionTools**: [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

### browserDelegationTools

> **browserDelegationTools**: [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

### browserSectionEnabled

> **browserSectionEnabled**: `boolean`

### browserTools

> **browserTools**: [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

### coreSectionEnabled

> **coreSectionEnabled**: `boolean`

### coreTools

> **coreTools**: [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

### deferredSectionEnabled

> **deferredSectionEnabled**: `boolean`

### deferredTools

> **deferredTools**: [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]

### groupedCore

> **groupedCore**: `Record`\<`string`, [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]\>

### groupedDeferred

> **groupedDeferred**: `Record`\<`string`, [`BuiltinTool`](../../../../../../shared/state/toolsSlice/interfaces/BuiltinTool.md)[]\>
