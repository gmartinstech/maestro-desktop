import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { updateSettingsPatch, closeSettingsModal, AppSettings } from '@/shared/state/settingsSlice';
import { fetchModels } from '@/shared/state/modelsSlice';
import { fetchModes } from '@/shared/state/modesSlice';
import { useThemeMode } from '@/shared/styles/ThemeContext';
import i18n from '@/shared/i18n/i18n';
import { makeSettingsStyles } from './settingsStyles';
import { DEFAULT_MODEL_FALLBACK } from './settingsConstants';

// Module-scope: remember the last open tab across modal closes (System Settings style).
let lastOpenTab: string | null = null;

const TAB_VALUES = ['general', 'models', 'skills', 'tools', 'commands', 'usage'] as const;
type SettingsTab = typeof TAB_VALUES[number];
const isValidTab = (t: string | null | undefined): t is SettingsTab =>
  !!t && (TAB_VALUES as readonly string[]).includes(t);

// Owns every non-render Settings concern (tab selection, form state, debounced save,
// live theme/language apply) so Settings.tsx stays a thin render of the result.
export function useSettingsController(c: any) {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.settings.data);
  const loaded = useAppSelector((s) => s.settings.loaded);
  const open = useAppSelector((s) => s.settings.modalOpen);
  const modes = useAppSelector((s) => s.modes.items);
  const { setMode: setThemeMode } = useThemeMode();

  const modesList = useMemo(() => Object.values(modes), [modes]);

  // Model picker source matches the in-session ChatInput picker, so Settings reflects connected providers.
  const modelsByProvider = useAppSelector((s) => s.models.byProvider);
  const modelsLoaded = useAppSelector((s) => s.models.loaded);

  const modelOptions = useMemo(() => {
    if (!modelsLoaded || Object.keys(modelsByProvider).length === 0) {
      return {
        grouped: { Anthropic: DEFAULT_MODEL_FALLBACK },
        flat: DEFAULT_MODEL_FALLBACK.map((m) => ({ ...m, provider: 'Anthropic' })),
      };
    }
    const grouped: Record<string, Array<{ value: string; label: string }>> = {};
    const flat: Array<{ value: string; label: string; provider: string }> = [];
    for (const [prov, models] of Object.entries(modelsByProvider)) {
      grouped[prov] = models.map((m) => ({ value: m.value, label: m.label }));
      for (const m of models) flat.push({ value: m.value, label: m.label, provider: prov });
    }
    // Guarantee the currently-selected default is always a valid option, even if the live list doesn't carry it (custom/OpenRouter value, or a stored model not in the current registry). Without this the dropdown gets an MUI "out-of-range value" warning and renders blank.
    const sel = settings.default_model;
    if (sel && !flat.some((m) => m.value === sel)) {
      const other = 'Other';
      (grouped[other] ||= []).push({ value: sel, label: sel });
      flat.push({ value: sel, label: sel, provider: other });
    }
    return { grouped, flat };
  }, [modelsByProvider, modelsLoaded, settings.connection_mode, settings.default_model]);

  const initialTab = useAppSelector((s) => s.settings.initialTab);
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    isValidTab(lastOpenTab) ? lastOpenTab : 'general',
  );
  const [form, setForm] = useState<AppSettings>({ ...settings });

  // Re-seed form on user change; otherwise the dirty detector falsely lights up Save/Discard.
  useEffect(() => {
    setForm({ ...settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.user_id, settings.user_email]);

  // Switch to requested tab when modal opens (e.g. from the "Configure models" banner link).
  useEffect(() => {
    if (initialTab && (TAB_VALUES as readonly string[]).includes(initialTab)) {
      setActiveTab(initialTab as SettingsTab);
    }
  }, [initialTab]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    dispatch(fetchModes());
  }, [dispatch]);

  useEffect(() => {
    if (open) dispatch(fetchModels());
  }, [open, dispatch]);

  useEffect(() => {
    // On open, restore the last open tab; explicit initialTab is handled by the effect above.
    if (open && !initialTab) {
      setActiveTab(isValidTab(lastOpenTab) ? lastOpenTab : 'general');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  useEffect(() => {
    lastOpenTab = activeTab;
  }, [activeTab]);

  // Sync form on modal open + first load only; including `settings` in deps wipes in-flight edits on background fetches (issue #25). baseline = the snapshot the user started editing from, so we can tell user edits apart from fields the backend changed underneath us (OAuth connects).
  const baselineRef = useRef<AppSettings>(settings);
  useEffect(() => {
    if (open && loaded) {
      setForm({ ...settings });
      baselineRef.current = settings;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]);

  // Apply-on-change (System Settings style): edits save themselves after a short debounce, so text fields settle between keystrokes and toggles feel instant.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  // Only the fields the user touched ride on top of the LATEST settings; submitting the whole stale form would clobber background updates and ping-pong with server-owned fields.
  const buildSubmit = useCallback((): { touched: string[]; patch: Partial<AppSettings> } | null => {
    const base = baselineRef.current as unknown as Record<string, unknown>;
    const f = form as unknown as Record<string, unknown>;
    const touched = Array.from(new Set([...Object.keys(base), ...Object.keys(f)]))
      .filter((k) => JSON.stringify(f[k]) !== JSON.stringify(base[k]));
    if (touched.length === 0) return null;
    // Send ONLY what the user changed; the server merges it onto fresh state, so we never re-send (and clobber) a field something else updated underneath us.
    const patch: Record<string, unknown> = {};
    for (const k of touched) patch[k] = f[k];
    return { touched, patch: patch as Partial<AppSettings> };
  }, [form]);

  // Theme is local UI state; apply it the moment the toggle flips, the debounced save persists it.
  useEffect(() => {
    if (open && loaded) setThemeMode(form.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.theme]);

  // Same pattern as theme above: apply the language toggle live, the debounced save (buildSubmit picks up `language` like any other field) persists it to the backend, which stays the source of truth on next boot.
  useEffect(() => {
    if (open && loaded && form.language) i18n.changeLanguage(form.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.language]);

  useEffect(() => {
    if (!open || !loaded) return;
    if (!buildSubmit()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      // A save already in flight will update `settings` when it lands, re-running this effect to pick up whatever is still unsaved.
      if (inFlight.current) return;
      const payload = buildSubmit();
      if (!payload) return;
      inFlight.current = true;
      try {
        await dispatch(updateSettingsPatch(payload.patch)).unwrap();
        // Absorb the saved edits so they stop counting as touched (prevents re-save loops).
        const nextBase = { ...baselineRef.current } as Record<string, unknown>;
        for (const k of payload.touched) nextBase[k] = (form as unknown as Record<string, unknown>)[k];
        baselineRef.current = nextBase as unknown as AppSettings;
        dispatch(fetchModels());
      } catch {
        setSaveError(true);
      } finally {
        inFlight.current = false;
      }
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [form, open, loaded, settings, dispatch, buildSubmit]);

  // Closing flushes any edit still inside the debounce window; nothing is ever lost or asked about.
  const handleRequestClose = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const payload = loaded ? buildSubmit() : null;
    if (payload) {
      // Refetch only AFTER the patch lands, or it races the save and reads the pre-change list (stale Haiku until you reopen Settings). Not awaited, so the modal still closes instantly.
      dispatch(updateSettingsPatch(payload.patch))
        .unwrap()
        .then(() => dispatch(fetchModels()))
        .catch(() => {});
      baselineRef.current = form;
    }
    dispatch(closeSettingsModal());
  }, [dispatch, form, loaded, buildSubmit]);

  const styles = makeSettingsStyles(c);

  return {
    open,
    modesList,
    modelOptions,
    activeTab,
    setActiveTab,
    form,
    setForm,
    showApiKey,
    setShowApiKey,
    browseOpen,
    setBrowseOpen,
    saveError,
    setSaveError,
    handleRequestClose,
    styles,
  };
}
