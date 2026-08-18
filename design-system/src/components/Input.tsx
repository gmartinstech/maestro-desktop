import type { InputHTMLAttributes } from 'react';
import { cx } from '../cx';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Field caption rendered above the control. */
  label?: string;
  /** Assistive line under the control; suppressed while `error` is set. */
  hint?: string;
  /** Validation message. Its presence also turns the border red. */
  error?: string;
  /** Marks the label with the required asterisk. */
  required?: boolean;
  /** Render the value in IBM Plex Mono — paths, keys, model ids. */
  mono?: boolean;
}

/** Single-line text field with label, hint and error slots. */
export function Input({ label, hint, error, required, mono, className, id, ...rest }: InputProps) {
  const control = (
    <input
      id={id}
      className={cx('mds-input', error && 'mds-input--error', mono && 'mds-mono', className)}
      aria-invalid={error ? true : undefined}
      required={required}
      {...rest}
    />
  );
  if (!label && !hint && !error) return control;
  return (
    <div className="mds-field">
      {label && (
        <label className="mds-label" htmlFor={id}>
          {label}
          {required && <span className="mds-label__req">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <span className="mds-help mds-help--error">{error}</span>
      ) : (
        hint && <span className="mds-help">{hint}</span>
      )}
    </div>
  );
}
