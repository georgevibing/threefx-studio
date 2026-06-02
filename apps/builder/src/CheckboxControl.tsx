import { Check } from "lucide-react";

export type CheckboxControlProps = {
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
};

export function CheckboxControl({
  ariaLabel,
  checked,
  className,
  disabled = false,
  onCheckedChange,
}: CheckboxControlProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={["threefx-checkbox", className].filter(Boolean).join(" ")}
      data-checked={checked ? "true" : "false"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    >
      {checked ? <Check size={13} strokeWidth={3} /> : null}
    </button>
  );
}
