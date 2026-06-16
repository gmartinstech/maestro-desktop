[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/onboardingProgressSlice](../README.md) / disableOnboardingAfterCrash

# Function: disableOnboardingAfterCrash()

> **disableOnboardingAfterCrash**(): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/onboardingProgressSlice.ts:70](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/onboardingProgressSlice.ts#L70)

Persist a hidden-on-crash marker straight to storage. The error boundary unmounts OnboardingRoot, so its own debounced persist effect can't run; write here or the dismissal won't survive a reload and the user re-enters the crash. Settings > restart tour clears it.

## Returns

`void`
