import type { TextareaHTMLAttributes } from 'react';
import { cx } from '../cx';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Monospace body — system prompts, JSON payloads, command templates. */
  mono?: boolean;
}

/** Multi-line field. Vertically resizable; use `mono` for anything code-shaped. */
export function Textarea({ label, hint, error, required, mono, className, id, ...rest }: TextareaProps) {
  return (
    <div className="mds-field">
      {label && (
        <label className="mds-label" htmlFor={id}>
          {label}
          {required && <span className="mds-label__req">*</span>}
        </label>
      )}
      <textarea
        id={id}
        className={cx('mds-textarea', error && 'mds-textarea--error', mono && 'mds-mono', className)}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      />
      {error ? (
        <span className="mds-help mds-help--error">{error}</span>
      ) : (
        hint && <span className="mds-help">{hint}</span>
      )}
    </div>
  );
}
