import React, { Suspense, useEffect, useState } from 'react';
import { useThemeMode } from '@/shared/styles/ThemeContext';
import { TOOL_UI_REGISTRY } from './registry';

interface VendoredToolUiProps {
  name: string;
  props: Record<string, unknown>;
}

type Gate = 'pending' | 'ok' | 'bad';

/** Validates against the upstream zod contract, then renders the vendored component inside the scoped theme. */
function VendoredToolUi({ name, props }: VendoredToolUiProps): React.ReactElement | null {
  const { mode } = useThemeMode();
  const entry = TOOL_UI_REGISTRY[name];
  const [gate, setGate] = useState<Gate>('pending');
  const [problem, setProblem] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    if (!entry) return undefined;
    entry
      .loadSchema()
      .then((schema) => {
        if (cancelled) return;
        const result = schema.safeParse(props);
        if (result.success) {
          setGate('ok');
        } else {
          setGate('bad');
          setProblem(result.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        }
      })
      .catch(() => { if (!cancelled) { setGate('bad'); setProblem('component failed to load'); } });
    return () => { cancelled = true; };
  }, [entry, props]);

  if (!entry) return null;
  if (gate === 'bad') {
    return (
      <div style={{ fontSize: '0.75rem', opacity: 0.55, padding: '4px 0' }}>
        {name} payload didn't validate ({problem})
      </div>
    );
  }
  if (gate === 'pending') {
    return <div style={{ height: 48, width: 280, borderRadius: 12, background: 'rgba(127,127,127,0.12)' }} />;
  }
  const Component = entry.Component;
  return (
    <div className={`tool-ui-scope${mode === 'dark' ? ' dark' : ''}`}>
      <Suspense fallback={<div style={{ height: 48, width: 280, borderRadius: 12, background: 'rgba(127,127,127,0.12)' }} />}>
        <Component {...props} />
      </Suspense>
    </div>
  );
}

export default VendoredToolUi;
