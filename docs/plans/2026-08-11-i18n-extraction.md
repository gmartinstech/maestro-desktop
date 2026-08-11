# I18N — finish the pt-BR localization pass

**Status:** queued. **Runs AFTER `osr/remove-openswarm-refs` merges** — OSR rewrites lines in
most of these same files, and doing this first guarantees conflicts across ~76 files.

## Problem

`1499d31a` shipped the i18n *mechanism* and a starter vocabulary, not the extraction.
The plumbing is correct and needs no changes:

- `frontend/src/shared/i18n/i18n.ts` — pt-BR default, `fallbackLng: 'en'`, persisted on
  `languageChanged`. Sound.
- Key parity is perfect: 167 keys in `en.json` and `pt-BR.json`, zero missing, zero orphaned.
- The 6 cross-locale-identical values are all legitimately identical (proper noun
  "Maestro Studio", cognates Menu/Apps/Interface, one empty string, one `" ({{tokens}} tokens)"`
  interpolation fragment). Do **not** "fix" these.

The gap is adoption: **6 of 183 `.tsx` files** call `useTranslation`. Selecting pt-BR
localizes the shell, onboarding and one Settings section; the other ~97% of the UI stays
English.

Measured surface: **185** hardcoded `label=`/`title=`/`placeholder=`/`helperText=`/`tooltip=`
props, **113** literal text nodes inside `<Typography>`/`<Button>`/`<MenuItem>`/`<Tab>`,
across **76 files**. Expect ~300 strings once aria-labels and toast/error text are included.

## Key namespace

Extend the existing top-level namespaces — do not invent a parallel scheme:
`common` (10), `appShell` (23), `settings` (1), `onboarding` (26), `agentChat` (2).

Add one namespace per page area, mirroring the route: `skills`, `tools`, `workflows`,
`dashboard`, `commands`, `views`, and grow `settings.*` per section
(`settings.general`, `settings.models`, `settings.usage`, …). Nest by component below that
(`tools.browserPermission.title`). Reuse `common.*` for Save/Cancel/Delete/Close — do not
re-declare them per page.

## Slices (by page area, disjoint file sets — parallelizable)

Counts are hardcoded-string hits, highest first. Recheck against the tree before starting:
Phase 0 of OSR deletes the Pro/subscription surface, so `SubscriptionCard.tsx` and
`SignInDialog.tsx` may no longer exist.

1. **Skills + Commands** — `Skills.tsx` (23), `SkillBuilderChat.tsx` (4),
   `CommunitySkillsDialog.tsx` (2), `Commands.tsx` (3).
2. **Tools** — `cards/BrowserPermissionCard.tsx` (17), `cards/CustomToolCard.tsx` (9),
   `Tools.tsx` (7), `dialogs/ToolDialogs.tsx` (6), `dialogs/RegistryServerRow.tsx` (6),
   `cards/ServiceGroup.tsx` (5), `dialogs/McpConfigDialog.tsx` (4), `cards/ToolSection.tsx` (4),
   `cards/CustomToolDevInfo.tsx` (4), `cards/BrowserLoginConnect.tsx` (3).
3. **Settings** — `general/GeneralAgentDefaults.tsx` (14), `general/DataPrivacySection.tsx` (14),
   `usage/UsageStats.tsx` (11), `general/GeneralAdvanced.tsx` (9),
   `models/CustomProvidersEditor.tsx` (7), `SettingsHeader.tsx` (6).
4. **Workflows** — `WorkflowCardLiveViews.tsx` (10), `app/StepsCard.tsx` (5),
   `WorkflowCardSubviews.tsx` (5), `SchedulePopover.tsx` (5), `ScheduleCalendar.tsx` (4),
   `app/RepeatField.tsx` (2), `app/LeftRail.tsx` (2).
5. **Dashboard + AgentChat + overlays** — `DashboardToolbar.tsx` (7),
   `cards/BrowserCard.tsx` (6), `controls/CanvasControls.tsx` (5),
   `AgentChat.tsx` (8), `shell/MessageActionBar.tsx` (6), `shell/ContextDrawer.tsx` (4),
   `components/share/PublishModal.tsx` (12), `overlays/GlobalSearchPalette.tsx` (4),
   `overlays/DynamicIsland.tsx` (3), plus the remaining 1-2 hit files.

## Rules for every slice

- Extract to `en.json` **and** translate in `pt-BR.json` in the same commit. Never leave a
  key English-only in pt-BR — `fallbackLng` hides the omission and the string silently stays
  English, which is exactly the bug being fixed.
- pt-BR must be real pt-BR (pt-BR technical register, not pt-PT). Keep product nouns
  untranslated: Maestro Studio, Skills, Workflows, MCP, agent/agente per existing usage in
  `pt-BR.json` — match the vocabulary already there rather than inventing synonyms.
- Use `{{interpolation}}`, never string concatenation, so pt-BR word order can differ.
- Pluralization goes through i18next `_one`/`_other` suffixes, not ternaries on `count`.
- Localize `aria-label`, `title` tooltips, toast/snackbar text and error messages, not just
  visible labels. Screen-reader text is user-facing.
- Do NOT touch `i18n.ts`, and do not alter the 6 legitimately-identical values.
- `backend/apps/outputs/webapp_template/**` is the template we ship to generated apps — it is
  NOT app UI. Leave it out of scope.

## Verify

1. `cd frontend && npx tsc --noEmit` clean; `npm run lint` clean.
2. Key parity holds both ways:
   `node -e "const e=require('./src/shared/i18n/en.json'),p=require('./src/shared/i18n/pt-BR.json');const f=(o,pre='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,pre+k+'.'):[pre+k]);const ek=f(e),pk=f(p);console.log('missing',ek.filter(k=>!pk.includes(k)),'extra',pk.filter(k=>!ek.includes(k)))"`
   → both arrays empty.
3. Untranslated-value count must not grow past the 6 known-identical keys.
4. Launch the app in pt-BR and walk every page in the slice; then switch to `en` and confirm
   no key names leak as raw text (`skills.title` rendering literally = a missing key).
5. `npm run verify` green before merge.

## Follow-up worth doing once

Add a CI guard so this cannot regress: a script that fails when `en.json` and `pt-BR.json`
key sets diverge, and (stretch) an ESLint rule flagging new hardcoded `label=`/`title=`
string literals in `frontend/src/app/**`. Wire into `scripts/verify.mjs`.
