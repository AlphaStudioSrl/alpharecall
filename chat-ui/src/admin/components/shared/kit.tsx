/**
 * The admin page kit: the handful of primitives every redesigned screen is
 * composed of. Styles live in kit.css (classes `ark-*`), values in the
 * tokens of admin.css, so light and dark come for free.
 *
 * Rules the kit encodes, so pages do not have to remember them:
 * - Separation by fill, never by border: the panel is white, a Group is a soft
 *   fill, a control on a fill is white again (the `ark-on-fill` class flips
 *   --ar-control for everything inside).
 * - Icons sit bare on the surface. No tinted tiles or circles behind icons.
 *   Avatars (initials) and buttons keep their fill.
 * - Every interactive piece is a real button/link/input with a visible
 *   keyboard focus (the neutral overlay from ui-surfaces.css).
 *
 * Quick reference:
 *   <PageHead title subtitle actions />           page title row (replaces the frame's default title)
 *   <Group label action><Row …/><Row …/></Group>  settings rows on a soft fill
 *   <Row label description htmlFor>{control}</Row>
 *   <Toggle checked onCheckedChange aria-label />
 *   <SelectPill value onValueChange options />    compact select (white on fills)
 *   <Segmented value onValueChange options />     2-4 exclusive options
 *   <Chips value onValueChange options />         filter chips with counts
 *   <Tag tone>Nuovo</Tag>  <Status tone>Lead</Status>
 *   <Avatar name src size />  <AvatarStack names />
 *   <Stat value label size />                     a number with its caption
 *   <ListItem leading title meta preview status active onClick />
 *   <SoftTable columns><SoftRow head>…</SoftRow></SoftTable>
 *   <Box>…</Box>                                  a soft card (x-box / x-card)
 *   <Panel>…</Panel>                              a white panel on the canvas (panels layout)
 *   <Empty icon title description action />
 *   <IconButton icon label onClick />
 *   <SearchField value onChange placeholder />
 *   <ProgressBar value tone label />  <KeyValue items />  <Feed items />  <Kbd>
 */
import React, { useId, useRef } from "react";
import { cn } from "@/admin/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, Search, type LucideIcon } from "@/components/icons";
import { useOwnPageHead } from "@/admin/components/layout/frame-context";

/** The semantic colour pairs of the design system. */
export type Tone = "accent" | "warn" | "info" | "violet" | "red" | "mute" | "ink";

/* ------------------------------------------------------------------ */
/*  Page structure                                                     */
/* ------------------------------------------------------------------ */

export interface PageHeadProps {
  title: React.ReactNode;
  /** One line under the title: counts, context, what the page is for. */
  subtitle?: React.ReactNode;
  /** Buttons aligned to the right of the title (primary action last). */
  actions?: React.ReactNode;
  /** Small line above the title (e.g. the date on Oggi). */
  eyebrow?: React.ReactNode;
  /** "lg" is the Oggi greeting size. */
  size?: "md" | "lg";
  className?: string;
}

/**
 * The page title row (x-head). Rendering it tells the frame to drop the
 * default title it shows above pages that have none.
 */
export function PageHead({ title, subtitle, actions, eyebrow, size = "md", className }: PageHeadProps) {
  useOwnPageHead();
  return <PageHeadView title={title} subtitle={subtitle} actions={actions} eyebrow={eyebrow} size={size} className={className} />;
}

/** PageHead without the frame registration; the frame uses it for its default title. */
export function PageHeadView({ title, subtitle, actions, eyebrow, size = "md", className }: PageHeadProps) {
  return (
    <div className={cn("ark-head", size === "lg" && "ark-head-lg", className)}>
      <div className="ark-head-text">
        {eyebrow && <p className="ark-head-eyebrow">{eyebrow}</p>}
        <h1 className="ark-head-title">{title}</h1>
        {subtitle && <p className="ark-head-sub">{subtitle}</p>}
      </div>
      {actions && <div className="ark-head-actions">{actions}</div>}
    </div>
  );
}

/**
 * A white panel on the canvas. Only for pages in the `panels` frame layout
 * (useFrameLayout({ panels: true })), which draw several side by side.
 */
export function Panel({
  children,
  className,
  grow,
  width,
  as: As = "section",
  ...props
}: React.HTMLAttributes<HTMLElement> & { grow?: boolean; width?: number | string; as?: "section" | "aside" | "div" }) {
  return (
    <As
      className={cn("ark-panel", grow && "ark-panel-grow", className)}
      style={width !== undefined ? { width, ...props.style } : props.style}
      {...props}
    >
      {children}
    </As>
  );
}

/** A soft card: content on --ar-fill (x-box), or white on a fill with `tone="panel"`. */
export function Box({
  children,
  className,
  tone = "fill",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: "fill" | "panel" }) {
  return (
    <div className={cn("ark-box", tone === "fill" ? "ark-on-fill" : "ark-box-panel", className)} {...props}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings rows                                                      */
/* ------------------------------------------------------------------ */

export interface GroupProps {
  /** Small caption above the rows ("Aspetto", "Inviti in attesa"). */
  label?: React.ReactNode;
  /** Something aligned right of the caption (a link, a count). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Rows on one soft fill, with an optional caption (x-group + x-rows). */
export function Group({ label, action, children, className }: GroupProps) {
  const id = useId();
  return (
    <section className={cn("ark-group", className)} aria-labelledby={label ? id : undefined}>
      {(label || action) && (
        <div className="ark-group-head">
          {label && <h2 id={id} className="ark-lbl">{label}</h2>}
          {action}
        </div>
      )}
      <div className="ark-rows ark-on-fill">{children}</div>
    </section>
  );
}

export interface RowProps {
  label: React.ReactNode;
  /** One quiet line under the label. */
  description?: React.ReactNode;
  /** The control on the right (Toggle, SelectPill, Segmented, a value, buttons). */
  children?: React.ReactNode;
  /** Id of the control the label names, so clicking the label focuses it. */
  htmlFor?: string;
  /** Makes the whole row a button that opens something (shows a chevron). */
  onClick?: () => void;
  /** Muted value shown before the chevron of a clickable row. */
  value?: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
}

/** One settings row: label + description left, control right (x-r). */
export function Row({ label, description, children, htmlFor, onClick, value, leading, className }: RowProps) {
  const text = (
    <span className="ark-row-text">
      {htmlFor ? <label htmlFor={htmlFor} className="ark-row-label">{label}</label> : <span className="ark-row-label">{label}</span>}
      {description && <small className="ark-row-desc">{description}</small>}
    </span>
  );
  if (onClick) {
    return (
      <button type="button" className={cn("ark-row ark-row-button", className)} onClick={onClick}>
        {leading}
        {text}
        {value !== undefined && <span className="ark-row-value">{value}</span>}
        <ChevronRight className="ark-row-chevron" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className={cn("ark-row", className)}>
      {leading}
      {text}
      {value !== undefined && <span className="ark-row-value">{value}</span>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Controls                                                           */
/* ------------------------------------------------------------------ */

/** On/off switch (x-tg). Accent when on. Give it an id + Row htmlFor, or an aria-label. */
export const Toggle = React.forwardRef<
  React.ElementRef<typeof Switch>,
  React.ComponentPropsWithoutRef<typeof Switch>
>(function Toggle({ className, ...props }, ref) {
  return <Switch ref={ref} className={cn("ark-toggle", className)} {...props} />;
});

export interface Option<V extends string = string> {
  value: V;
  label: React.ReactNode;
  /** Shown faint after the label (chips: "Tutti 212"). */
  count?: React.ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SelectPillProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  options: Option<V>[];
  /** Accessible name when no visible label points at it. */
  "aria-label"?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** A compact select that sizes to its value (x-sel): white on fills, soft on the panel. */
export function SelectPill<V extends string>({ value, onValueChange, options, placeholder, disabled, className, id, ...aria }: SelectPillProps<V>) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as V)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={aria["aria-label"]} className={cn("ark-select", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface SegmentedProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  options: Option<V>[];
  "aria-label": string;
  /** "chips": separate pills, the chosen one ink (filters). Default: one track (x-seg). */
  variant?: "track" | "chips";
  size?: "sm" | "md";
  className?: string;
}

/**
 * Pick one of a few options (x-seg), or filter chips (x-chips) with
 * `variant="chips"`. A radiogroup: Tab enters at the chosen option, arrow keys
 * move and select.
 */
export function Segmented<V extends string>({
  value,
  onValueChange,
  options,
  variant = "track",
  size = "md",
  className,
  ...aria
}: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.filter((o) => !o.disabled);
  const move = (from: number, step: number) => {
    const order = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled);
    const at = order.findIndex(({ i }) => i === from);
    const next = order[(at + step + order.length) % order.length];
    if (!next) return;
    onValueChange(next.o.value);
    refs.current[next.i]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={cn(variant === "chips" ? "ark-chips" : "ark-seg", size === "sm" && "ark-seg-sm", className)}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            tabIndex={on || (!enabled.some((e) => e.value === value) && i === 0) ? 0 : -1}
            data-on={on || undefined}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
            }}
          >
            {Icon && <Icon aria-hidden="true" />}
            {o.label}
            {o.count !== undefined && <em>{o.count}</em>}
          </button>
        );
      })}
    </div>
  );
}

/** Filter chips: Segmented with the chips look. */
export function Chips<V extends string>(props: Omit<SegmentedProps<V>, "variant">) {
  return <Segmented {...props} variant="chips" />;
}

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
}

/** A pill search input with a bare magnifier ("Cerca persone"). */
export function SearchField({ value, onChange, label, placeholder, className, ...props }: SearchFieldProps) {
  return (
    <label className={cn("ark-search", className)}>
      <Search aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </label>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name, also the tooltip. Required: the button has no text. */
  label: string;
  /** A soft fill behind the button (x-ib.f). The icon itself never gets a tile. */
  filled?: boolean;
  size?: "sm" | "md";
}

/** A bare icon button (x-ib): no tile, a soft fill only on hover/focus. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, filled, size = "md", className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn("ark-ib", filled && "ark-ib-filled", size === "sm" && "ark-ib-sm", className)}
      {...props}
    >
      <Icon aria-hidden="true" />
    </button>
  );
});

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

/** A soft pill label in one of the tone pairs (x-tag). `dot` adds a leading dot. */
export function Tag({ tone = "mute", dot, children, className }: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return <span className={cn("ark-tag", `ark-b-${tone}`, dot && "ark-tag-dot", className)}>{children}</span>;
}

/** Coloured dot + text, no fill (x-st): the status line of a list item. */
export function Status({ tone = "mute", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("ark-status", `ark-c-${tone}`, className)}>{children}</span>;
}

/** A keyboard key ("Esc", "Ctrl K"). */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("ark-kbd", className)}>{children}</kbd>;
}

/* ------------------------------------------------------------------ */
/*  People                                                             */
/* ------------------------------------------------------------------ */

const AVATAR_TONES: Tone[] = ["warn", "info", "violet", "accent", "mute"];

/** Up to two initials from a name or an e-mail address. */
export function initials(name: string): string {
  const clean = (name || "").replace(/@.*$/, "").replace(/[._-]+/g, " ").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, parts[0].length > 1 && /\d/.test(parts[0]) ? 1 : 2);
  return letters.toUpperCase();
}

/** A stable tone for a name, so a person keeps their colour on every screen. */
export function toneFor(key: string): Tone {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

export interface AvatarProps {
  /** Person's name or e-mail; gives the initials, the colour and the alt text. */
  name: string;
  /** Photo URL. Initials are shown when absent or broken. */
  src?: string | null;
  size?: "s" | "m" | "l";
  tone?: Tone;
  className?: string;
}

/** A round avatar with initials on a soft tone, or a photo (x-av). Decorative unless `name` is the only label. */
export function Avatar({ name, src, size = "m", tone, className }: AvatarProps) {
  const [broken, setBroken] = React.useState(false);
  const cls = cn("ark-av", `ark-av-${size}`, `ark-b-${tone ?? toneFor(name || "?")}`, className);
  if (src && !broken) {
    return <img className={cls} src={src} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className={cls} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars ("3 operatori visibili"). */
export function AvatarStack({ people, max = 4, size = "s" }: { people: { name: string; src?: string | null }[]; max?: number; size?: AvatarProps["size"] }) {
  const shown = people.slice(0, max);
  return (
    <span className="ark-av-stack" aria-hidden="true">
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} src={p.src} size={size} />
      ))}
      {people.length > max && <span className={cn("ark-av", `ark-av-${size}`, "ark-b-mute")}>+{people.length - max}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Numbers                                                            */
/* ------------------------------------------------------------------ */

/** A number with its caption (x-big / x-mid). */
export function Stat({ value, label, size = "big", hint, className }: { value: React.ReactNode; label: React.ReactNode; size?: "big" | "mid"; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("ark-stat", className)}>
      <span className={size === "big" ? "ark-big" : "ark-mid"}>{value}</span>
      <span className="ark-stat-label">{label}</span>
      {hint && <span className="ark-stat-hint">{hint}</span>}
    </div>
  );
}

/** A thin progress bar (x-bar). `value` 0..100. */
export function ProgressBar({ value, tone = "ink", label, className }: { value: number; tone?: "ink" | "accent"; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn("ark-bar", tone === "accent" && "ark-bar-accent", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

/** Label / value pairs in two columns (x-kv). */
export function KeyValue({ items, className }: { items: Array<[React.ReactNode, React.ReactNode]>; className?: string }) {
  return (
    <dl className={cn("ark-kv", className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A quiet timeline: time on the left, one line of text (x-feed). */
export function Feed({ items, className }: { items: { key: React.Key; time: React.ReactNode; content: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("ark-feed", className)}>
      {items.map((item) => (
        <li key={item.key}>
          <small>{item.time}</small>
          <span>{item.content}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Lists and tables                                                   */
/* ------------------------------------------------------------------ */

export interface ListItemProps {
  /** Usually an <Avatar>. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Right of the title, faint (a time). */
  meta?: React.ReactNode;
  /** One truncated line under the title. */
  preview?: React.ReactNode;
  /** A <Status> line under the preview. */
  status?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** Extra attributes for the root (aria-*, data-*). */
  rootProps?: React.HTMLAttributes<HTMLElement>;
}

/** A conversation / person row (x-li). A button when `onClick` is set. */
export function ListItem({ leading, title, meta, preview, status, active, onClick, className, rootProps }: ListItemProps) {
  const body = (
    <>
      {leading}
      <span className="ark-li-body">
        <span className="ark-li-top">
          <b>{title}</b>
          {meta && <small>{meta}</small>}
        </span>
        {preview && <span className="ark-li-preview">{preview}</span>}
        {status}
      </span>
    </>
  );
  const cls = cn("ark-li", active && "ark-li-on", className);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-current={active || undefined} {...rootProps}>
      {body}
    </button>
  ) : (
    <div className={cls} {...rootProps}>
      {body}
    </div>
  );
}

/**
 * A borderless table with a soft zebra (x-tbl). `columns` is a CSS
 * grid-template-columns value shared by every row, e.g. "2fr 1fr 1fr 40px".
 * Uses ARIA table roles; for sortable or huge data prefer ui/table.
 */
export function SoftTable({ columns, label, children, className }: { columns: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="table" aria-label={label} className={cn("ark-tbl", className)} style={{ ["--ark-cols" as string]: columns }}>
      {children}
    </div>
  );
}

/**
 * A SoftTable row. `head` makes it the header row; `onClick` makes it a
 * keyboard stop (Enter or Space opens it). `active` marks the row whose
 * details are open: aria-current, since aria-selected is not allowed on a
 * row of a plain table (only in grid/treegrid).
 */
/** `dataKey` names the record (data-key), so focus can find the row again after a re-render. */
export function SoftRow({ head, active, onClick, children, className, dataKey }: { head?: boolean; active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string; dataKey?: string }) {
  return (
    <div
      role="row"
      data-key={dataKey}
      className={cn("ark-tr", head && "ark-th", active && "ark-tr-on", onClick && "ark-tr-click", className)}
      aria-current={active ? "true" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      {children}
    </div>
  );
}

/** A SoftTable cell (`head` for header cells). */
export function SoftCell({ head, children, className }: { head?: boolean; children?: React.ReactNode; className?: string }) {
  return <div role={head ? "columnheader" : "cell"} className={cn("ark-td", className)}>{children}</div>;
}

/** A person cell: avatar, name and a faint second line. */
export function WhoCell({ name, detail, src }: { name: string; detail?: React.ReactNode; src?: string | null }) {
  return (
    <div role="cell" className="ark-td ark-who">
      <Avatar name={name} src={src} size="s" />
      {/* A class, not `> span`: the initials avatar is a span too. */}
      <span className="ark-who-text">
        <b>{name}</b>
        {detail && <small>{detail}</small>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

/** Nothing here yet: a bare icon, a sentence, maybe one action. */
export function Empty({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("ark-empty", className)}>
      {Icon && <Icon aria-hidden="true" className="ark-empty-icon" />}
      <p className="ark-empty-title">{title}</p>
      {description && <p className="ark-empty-desc">{description}</p>}
      {action && <div className="ark-empty-action">{action}</div>}
    </div>
  );
}
