[**open-swarm**](../../../../../../README.md)

***

[open-swarm](../../../../../../README.md) / [app/pages/AgentChat/shell/ApprovalBar](../README.md) / QuestionFormProps

# Interface: QuestionFormProps

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx:305](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx#L305)

## Properties

### compact?

> `optional` **compact?**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx:309](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx#L309)

***

### onApprove

> **onApprove**: (`requestId`, `updatedInput?`, `trustPattern?`) => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx:307](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx#L307)

#### Parameters

##### requestId

`string`

##### updatedInput?

`Record`\<`string`, `any`\>

##### trustPattern?

`boolean`

#### Returns

`void`

***

### onDeny

> **onDeny**: (`requestId`, `message?`) => `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx:308](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx#L308)

#### Parameters

##### requestId

`string`

##### message?

`string`

#### Returns

`void`

***

### request

> **request**: [`ApprovalRequest`](../../../../../../shared/state/agentsSlice/interfaces/ApprovalRequest.md)

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx:306](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/AgentChat/shell/ApprovalBar.tsx#L306)
