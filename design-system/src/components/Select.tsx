import type { SelectHTMLAttributes } from 'react';
import { cx } from '../cx';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  hint?: string;
  error?: string;
  /** The choices. Grouping is not supported — split into two Selects instead. */
  options: SelectOption[];
  /** Shown as a disabled first row when no value is set. */
  placeholder?: string;
}

/** Native single-choice control, restyled to the token layer with a drawn chevron. */
export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  id,
  ...rest
}: SelectProps) {
  return (
    <div className="mds-field">
      {label && (
        <label className="mds-label" htmlFor={id}>
          {label}
        </label>
      )}
      <select id={id} className={cx('mds-select', className)} {...rest}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="mds-help mds-help--error">{error}</span>
      ) : (
        hint && <span className="mds-help">{hint}</span>
      )}
    </div>
  );
}
