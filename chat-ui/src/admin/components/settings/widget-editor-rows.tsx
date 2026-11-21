import { cn } from "@/admin/lib/utils";
import { HelpTooltip } from "@/admin/components/shared/help-tooltip";

/**
 * The widget editor's settings rows, on the kit's .ark-row look. SettingRow
 * puts the control on the right (switches, short selects, swatches);
 * StackRow puts it under the label at full width (text fields, wide choices).
 * A row can carry the "?" help the old form had next to each field.
 */
interface RowProps {
  label: React.ReactNode;
  /** Long explanation behind a "?" button next to the label. */
  help?: string;
  /** One quiet line under the label. */
  description?: React.ReactNode;
  /** Id of the control, so the label names and focuses it. */
  htmlFor?: string;
  /** Dims the row; the control itself must be disabled too. */
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

function RowText({ label, help, description, htmlFor }: Pick<RowProps, "label" | "help" | "description" | "htmlFor">) {
  return (
    <span className="ark-row-text">
      <span className="we-row-label">
        {htmlFor ? <label htmlFor={htmlFor} className="ark-row-label">{label}</label> : <span className="ark-row-label">{label}</span>}
        {help && <HelpTooltip text={help} />}
      </span>
      {description && <small className="ark-row-desc">{description}</small>}
    </span>
  );
}

export function SettingRow({ label, help, description, htmlFor, disabled, children, className }: RowProps) {
  return (
    <div className={cn("ark-row", disabled && "we-row-disabled", className)}>
      <RowText label={label} help={help} description={description} htmlFor={htmlFor} />
      {children !== undefined && <div className="we-row-control">{children}</div>}
    </div>
  );
}

export function StackRow({ label, help, description, htmlFor, disabled, children, className }: RowProps) {
  return (
    <div className={cn("ark-row we-row-stack", disabled && "we-row-disabled", className)}>
      <RowText label={label} help={help} description={description} htmlFor={htmlFor} />
      {children}
    </div>
  );
}
