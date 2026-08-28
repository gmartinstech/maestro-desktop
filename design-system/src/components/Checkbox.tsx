import { cx } from '../cx';

export interface CheckboxProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label: string;
  /** Second line under the label — what the setting actually does. */
  description?: string;
  disabled?: boolean;
  className?: string;
}

/** Labelled checkbox. The box is drawn, not native, so it follows the token colours exactly. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: CheckboxProps) {
  return (
    <label className={cx('mds-check', disabled && 'mds-check--disabled', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span className={cx('mds-check__box', checked && 'mds-check__box--on')} aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.2L4.8 8.5L9.5 3.8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        {label}
        {description && <span className="mds-check__desc">{description}</span>}
      </span>
    </label>
  );
}
