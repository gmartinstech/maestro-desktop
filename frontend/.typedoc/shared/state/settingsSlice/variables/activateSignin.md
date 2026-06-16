[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/settingsSlice](../README.md) / activateSignin

# Variable: activateSignin

> `const` **activateSignin**: `AsyncThunk`\<\{ `email`: `string`; `ok`: `boolean`; `plan`: `string`; `signin_method`: `"google"` \| `"email"`; `user_id`: `string`; \}, [`ActivateSigninPayload`](../interfaces/ActivateSigninPayload.md), `AsyncThunkConfig`\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/settingsSlice.ts:189](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/settingsSlice.ts#L189)

POST /api/auth/signin-activate after catching Google OAuth/magic-link bearer; persists identity.
