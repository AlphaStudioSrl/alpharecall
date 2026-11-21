/**
 * tour-engine.ts
 * A small guided-tour engine for the admin section tours (use-tour.ts). It
 * replaces intro.js, whose AGPL-3.0 licence (or a paid commercial licence)
 * does not fit a GPLv2-or-later plugin on WordPress.org.
 *
 * One step at a time: the anchor is outlined and the rest of the page dimmed,
 * a dialog next to it carries the title, the text, a progress bar and the
 * Skip / Back / Next (Done on the last step) buttons. Escape, Skip and a click
 * on the dimmed area end the tour; the anchor itself stays clickable.
 *
 * Callbacks follow intro.js: `onchange(el)` before a step shows,
 * `oncomplete()` when Done is pressed, then `onexit()`; `onexit()` also fires
 * on Skip, Escape, an outside click and a programmatic `exit()`.
 */

export type TourPosition = "top" | "bottom" | "left" | "right" | "auto";

export interface TourEngineStep {
  element: string;
  title: string;
  intro: string;
  position?: TourPosition;
}

export interface TourEngineOptions {
  steps: TourEngineStep[];
  labels: { next: string; prev: string; skip: string; done: string };
  showProgress?: boolean;
  exitOnOverlayClick?: boolean;
  exitOnEsc?: boolean;
  /** Space between the anchor and its outline, in px. */
  padding?: number;
}

/** Class set on the anchor of the current step (use-tour follows it). */
export const TARGET_CLASS = "ar-tour-target";

const GAP = 12;
const MARGIN = 8;

function query(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

export class TourEngine {
  private readonly options: Required<Omit<TourEngineOptions, "steps" | "labels">> &
    Pick<TourEngineOptions, "steps" | "labels">;
  private index = -1;
  private root: HTMLDivElement | null = null;
  private highlight: HTMLDivElement | null = null;
  private blockers: HTMLDivElement[] = [];
  private tooltip: HTMLDivElement | null = null;
  private target: HTMLElement | null = null;
  private changeCallback: ((el: HTMLElement | null) => void) | null = null;
  private completeCallback: (() => void) | null = null;
  private exitCallback: (() => void) | null = null;
  private readonly onKeyDown = (event: KeyboardEvent) => this.handleKey(event);
  private readonly onViewport = () => this.refresh();

  constructor(options: TourEngineOptions) {
    this.options = {
      showProgress: true,
      exitOnOverlayClick: true,
      exitOnEsc: true,
      padding: 8,
      ...options,
    };
  }

  onchange(callback: (el: HTMLElement | null) => void): this {
    this.changeCallback = callback;
    return this;
  }

  oncomplete(callback: () => void): this {
    this.completeCallback = callback;
    return this;
  }

  onexit(callback: () => void): this {
    this.exitCallback = callback;
    return this;
  }

  get isActive(): boolean {
    return this.root !== null;
  }

  get currentStep(): number {
    return this.index;
  }

  start(): this {
    if (this.root || this.options.steps.length === 0) return this;
    this.build();
    document.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onViewport);
    window.addEventListener("scroll", this.onViewport, true);
    this.goTo(0);
    return this;
  }

  next(): void {
    if (this.index >= this.options.steps.length - 1) {
      this.completeCallback?.();
      this.exit();
      return;
    }
    this.goTo(this.index + 1);
  }

  previous(): void {
    if (this.index > 0) this.goTo(this.index - 1);
  }

  /** Ends the tour (the argument mirrors intro.js's exit(force) and is ignored). */
  exit(_force?: boolean): void {
    if (!this.root) return;
    document.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onViewport);
    window.removeEventListener("scroll", this.onViewport, true);
    this.target?.classList.remove(TARGET_CLASS);
    this.target = null;
    this.root.remove();
    this.root = null;
    this.highlight = null;
    this.tooltip = null;
    this.blockers = [];
    this.index = -1;
    this.exitCallback?.();
  }

  /** Re-measures the anchor and moves the outline and the dialog with it. */
  refresh(): void {
    if (!this.root || !this.highlight || !this.tooltip) return;
    const step = this.options.steps[this.index];
    const target = this.target && this.target.isConnected ? this.target : query(step.element);
    if (target !== this.target) {
      this.target?.classList.remove(TARGET_CLASS);
      target?.classList.add(TARGET_CLASS);
      this.target = target;
    }
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const pad = this.options.padding;
    const rect = target?.getBoundingClientRect();
    const hole = rect && rect.width > 0 && rect.height > 0
      ? {
          top: Math.max(0, rect.top - pad),
          left: Math.max(0, rect.left - pad),
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }
      : null;

    if (hole) {
      Object.assign(this.highlight.style, {
        display: "block",
        top: `${hole.top}px`,
        left: `${hole.left}px`,
        width: `${hole.width}px`,
        height: `${hole.height}px`,
      });
    } else {
      this.highlight.style.display = "none";
    }
    this.placeBlockers(hole, viewportWidth, viewportHeight);
    this.placeTooltip(hole, step.position ?? "auto", viewportWidth, viewportHeight);
  }

  private build(): void {
    const root = document.createElement("div");
    root.className = "ar-tour-overlay";
    for (let i = 0; i < 4; i++) {
      const blocker = document.createElement("div");
      blocker.className = "ar-tour-blocker";
      blocker.addEventListener("click", () => {
        if (this.options.exitOnOverlayClick) this.exit();
      });
      root.appendChild(blocker);
      this.blockers.push(blocker);
    }
    const highlight = document.createElement("div");
    highlight.className = "ar-tour-highlight";
    root.appendChild(highlight);

    const tooltip = document.createElement("div");
    tooltip.className = "ar-tour-tooltip";
    tooltip.setAttribute("role", "dialog");
    tooltip.setAttribute("aria-modal", "false");
    tooltip.setAttribute("aria-labelledby", "ar-tour-title");
    tooltip.setAttribute("aria-describedby", "ar-tour-text");
    root.appendChild(tooltip);

    document.body.appendChild(root);
    this.root = root;
    this.highlight = highlight;
    this.tooltip = tooltip;
  }

  private goTo(index: number): void {
    if (!this.root || !this.tooltip) return;
    this.index = index;
    const step = this.options.steps[index];
    const target = query(step.element);
    this.changeCallback?.(target);
    this.target?.classList.remove(TARGET_CLASS);
    this.target = target;
    target?.classList.add(TARGET_CLASS);
    this.renderTooltip(step);
    this.refresh();
    this.tooltip.querySelector<HTMLButtonElement>(".ar-tour-next")?.focus({ preventScroll: true });
  }

  private renderTooltip(step: TourEngineStep): void {
    const tooltip = this.tooltip!;
    const { labels, steps, showProgress } = this.options;
    const last = this.index === steps.length - 1;
    tooltip.replaceChildren();

    const title = document.createElement("h2");
    title.className = "ar-tour-title";
    title.id = "ar-tour-title";
    title.textContent = step.title;

    const text = document.createElement("p");
    text.className = "ar-tour-text";
    text.id = "ar-tour-text";
    text.textContent = step.intro;

    tooltip.append(title, text);

    if (showProgress) {
      const progress = document.createElement("div");
      progress.className = "ar-tour-progress";
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "1");
      progress.setAttribute("aria-valuemax", String(steps.length));
      progress.setAttribute("aria-valuenow", String(this.index + 1));
      const bar = document.createElement("span");
      bar.style.width = `${((this.index + 1) / steps.length) * 100}%`;
      progress.appendChild(bar);
      tooltip.appendChild(progress);
    }

    const buttons = document.createElement("div");
    buttons.className = "ar-tour-buttons";
    const button = (className: string, label: string, onClick: () => void) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `ar-tour-button ${className}`;
      element.textContent = label;
      element.addEventListener("click", onClick);
      return element;
    };
    buttons.appendChild(button("ar-tour-skip", labels.skip, () => this.exit()));
    const back = button("ar-tour-prev", labels.prev, () => this.previous());
    back.disabled = this.index === 0;
    buttons.appendChild(back);
    buttons.appendChild(button("ar-tour-next", last ? labels.done : labels.next, () => this.next()));
    tooltip.appendChild(buttons);
  }

  /** Four click areas around the outlined anchor: a click there ends the tour, the anchor stays usable. */
  private placeBlockers(
    hole: { top: number; left: number; width: number; height: number } | null,
    width: number,
    height: number,
  ): void {
    const rects = hole
      ? [
          { top: 0, left: 0, width, height: hole.top },
          { top: hole.top + hole.height, left: 0, width, height: Math.max(0, height - hole.top - hole.height) },
          { top: hole.top, left: 0, width: hole.left, height: hole.height },
          { top: hole.top, left: hole.left + hole.width, width: Math.max(0, width - hole.left - hole.width), height: hole.height },
        ]
      : [
          { top: 0, left: 0, width, height },
          { top: 0, left: 0, width: 0, height: 0 },
          { top: 0, left: 0, width: 0, height: 0 },
          { top: 0, left: 0, width: 0, height: 0 },
        ];
    rects.forEach((rect, i) => {
      Object.assign(this.blockers[i].style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${Math.max(0, rect.width)}px`,
        height: `${Math.max(0, rect.height)}px`,
      });
    });
    // Without an anchor the dimming comes from the full-screen click area.
    this.blockers[0].classList.toggle("ar-tour-dim", !hole);
  }

  private placeTooltip(
    hole: { top: number; left: number; width: number; height: number } | null,
    position: TourPosition,
    width: number,
    height: number,
  ): void {
    const tooltip = this.tooltip!;
    const box = tooltip.getBoundingClientRect();
    const tw = box.width || 320;
    const th = box.height || 160;
    const clampX = (x: number) => Math.min(Math.max(MARGIN, x), Math.max(MARGIN, width - tw - MARGIN));
    const clampY = (y: number) => Math.min(Math.max(MARGIN, y), Math.max(MARGIN, height - th - MARGIN));

    if (!hole) {
      tooltip.dataset.placement = "center";
      tooltip.style.top = `${clampY((height - th) / 2)}px`;
      tooltip.style.left = `${clampX((width - tw) / 2)}px`;
      return;
    }
    const space = {
      bottom: height - (hole.top + hole.height),
      top: hole.top,
      right: width - (hole.left + hole.width),
      left: hole.left,
    };
    const fits = {
      bottom: space.bottom >= th + GAP,
      top: space.top >= th + GAP,
      right: space.right >= tw + GAP,
      left: space.left >= tw + GAP,
    };
    let placement: Exclude<TourPosition, "auto">;
    if (position !== "auto" && fits[position]) {
      placement = position;
    } else {
      placement = (["bottom", "top", "right", "left"] as const).find((side) => fits[side]) ?? "bottom";
    }
    let top: number;
    let left: number;
    switch (placement) {
      case "top":
        top = hole.top - th - GAP;
        left = hole.left + hole.width / 2 - tw / 2;
        break;
      case "right":
        top = hole.top + hole.height / 2 - th / 2;
        left = hole.left + hole.width + GAP;
        break;
      case "left":
        top = hole.top + hole.height / 2 - th / 2;
        left = hole.left - tw - GAP;
        break;
      default:
        top = hole.top + hole.height + GAP;
        left = hole.left + hole.width / 2 - tw / 2;
    }
    tooltip.dataset.placement = placement;
    tooltip.style.top = `${clampY(top)}px`;
    tooltip.style.left = `${clampX(left)}px`;
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.root) return;
    if (event.key === "Escape" && this.options.exitOnEsc) {
      event.preventDefault();
      event.stopPropagation();
      this.exit();
    } else if (event.key === "ArrowRight" && !this.isTyping(event)) {
      // Like intro.js, the arrow keys move between steps but never finish the tour.
      event.preventDefault();
      if (this.index < this.options.steps.length - 1) this.goTo(this.index + 1);
    } else if (event.key === "ArrowLeft" && !this.isTyping(event)) {
      event.preventDefault();
      this.previous();
    }
  }

  private isTyping(event: KeyboardEvent): boolean {
    const element = event.target as HTMLElement | null;
    if (!element) return false;
    return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
  }
}
