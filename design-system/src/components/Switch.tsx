import { cx } from '../cx';

export interface SwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** Accessible name. Pair with `SwitchRow` when the label should be visible. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Instant-apply toggle — the Settings pattern. Use Checkbox when the change needs a Save. */
export function Switch({ checked, onChange, label, disabled = false, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cx('mds-switch', checked && 'mds-switch--on', className)}
    />
  );
}

export interface SwitchRowProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label: string;
  /** Explains the consequence of turning it on — every Settings row has one. */
  description?: string;
  disabled?: boolean;
  className?: string;
}

/** A Switch with its label and description laid out as a full-width settings row. */
export function SwitchRow({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: SwitchRowProps) {
  return (
    <div className={cx('mds-switch-row', className)}>
      <span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
        {description && <span className="mds-check__desc">{description}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}
