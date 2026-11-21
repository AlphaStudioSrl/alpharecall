/**
 * Richieste as a board (mockup richieste B): Nuove, In corso, Fatte, with a
 * card per request of any type. Drag a card to another column to change its
 * status; the card's menu does the same from the keyboard or a phone.
 *
 * Leads are not cards: their status is the email opt-in, not a follow-up
 * stage, so they sit in a "Contatti raccolti" strip above the columns. With
 * the Lead filter the board shows them as a grid of cards: still a board,
 * not a switch to the list.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Avatar, IconButton } from "@/admin/components/shared/kit";
import { NavLink } from "@/admin/lib/nav-context";
import { cn } from "@/admin/lib/utils";
import { MoreHorizontal } from "@/components/icons";
import { KindTag, StatusMenu, columnLabel, stars } from "./parts";
import { ageLabel, COLUMNS, targetStatus, type Column, type ColumnTotals, type RequestItem } from "./request-model";

type T = (key: string) => string;

export function RequestBoard({ items, t, busy, onOpen, onSetStatus, onShowLeads, totals, leadsTotal, leadsOnly = false }: {
  items: RequestItem[];
  t: T;
  /** Column sizes over the whole collections; null falls back to the cards loaded. */
  totals?: ColumnTotals | null;
  /** Every lead collected, not the page loaded. */
  leadsTotal?: number;
  /** The Lead filter: the leads as cards, no columns. */
  leadsOnly?: boolean;
  /** Keys with a status change in flight. */
  busy: Set<string>;
  onOpen: (item: RequestItem) => void;
  onSetStatus: (item: RequestItem, status: string) => void;
  /** "Vedi tutti" on the leads strip: the page filters to leads (LeadGrid). */
  onShowLeads: () => void;
}) {
  const [active, setActive] = useState<RequestItem | null>(null);
  // A small travel before a drag starts, so a click still opens the card.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = (event: DragStartEvent) => {
    setActive(items.find((i) => i.key === event.active.id) ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const item = items.find((i) => i.key === event.active.id);
    setActive(null);
    const column = event.over?.id as Column | undefined;
    if (!item || !column || column === item.column) return;
    const status = targetStatus(item, column);
    if (status) onSetStatus(item, status);
  };

  const leads = items.filter((i) => i.column === null);
  if (leadsOnly) {
    return <LeadGrid leads={leads} total={leadsTotal ?? leads.length} t={t} onOpen={onOpen} />;
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="a3-board-wrap">
      <LeadStrip leads={leads} total={leadsTotal ?? leads.length} t={t} onOpen={onOpen} onShowAll={onShowLeads} />
      <div className="a3-board" data-tour="conversions-table">
        {COLUMNS.map((column) => (
          <BoardColumn
            key={column}
            column={column}
            items={items.filter((i) => i.column === column)}
            total={totals?.[column]}
            t={t}
            busy={busy}
            dragging={active}
            onOpen={onOpen}
            onSetStatus={onSetStatus}
          />
        ))}
      </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <CardFace item={active} t={t} overlay />}
      </DragOverlay>
    </DndContext>
  );
}

const STRIP_PEOPLE = 12;

/**
 * Which ends of a horizontal scroller still hide chips, for the fade that
 * says so: the strip hides its scrollbar, and a cut-off chip under "Vedi
 * tutti" looked like the end of the list.
 */
function useScrollEdges<T extends HTMLElement>(mounted: boolean) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > 1;
    const end = max - el.scrollLeft > 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, mounted]);
  return { ref, edges, measure };
}

/** Leads collected in chat: newest first, a row of names that scrolls, and the way to all of them. */
function LeadStrip({ leads, total, t, onOpen, onShowAll }: {
  leads: RequestItem[];
  total: number;
  t: T;
  onOpen: (item: RequestItem) => void;
  onShowAll: () => void;
}) {
  const { ref, edges, measure } = useScrollEdges<HTMLUListElement>(leads.length > 0);
  const shown = leads.slice(0, STRIP_PEOPLE);
  useEffect(measure, [measure, shown.length]);
  if (leads.length === 0) return null;
  const id = "a3-leads-title";
  return (
    <section className="a3-leads" aria-labelledby={id}>
      <h2 id={id}>{t("conversions.board.leadsTitle")} <span>{total}</span></h2>
      <ul ref={ref} data-fade-start={edges.start || undefined} data-fade-end={edges.end || undefined}>
        {shown.map((lead) => (
          <li key={lead.key}>
            {/* The full name and email on hover: the chip cuts long names. */}
            <button type="button" onClick={() => onOpen(lead)} title={[lead.name, lead.email !== lead.name ? lead.email : ""].filter(Boolean).join(" · ")}>
              <Avatar name={lead.name} size="s" />
              <span>{lead.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="a3-leads-all" onClick={onShowAll}>{t("conversions.board.leadsAll")}</Button>
    </section>
  );
}

/** The Lead filter on the board: every loaded lead as a card. */
function LeadGrid({ leads, total, t, onOpen }: {
  leads: RequestItem[];
  total: number;
  t: T;
  onOpen: (item: RequestItem) => void;
}) {
  const id = "a3-leads-grid-title";
  return (
    <section className="a3-lead-grid" aria-labelledby={id} data-tour="conversions-table">
      <header className="a3-col-head">
        <h2 id={id}>{t("conversions.board.leadsTitle")}</h2>
        <span>{total}</span>
      </header>
      <div className="a3-lead-grid-list">
        {leads.map((lead) => <CardFace key={lead.key} item={lead} t={t} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function BoardColumn({ column, items, total, t, busy, dragging, onOpen, onSetStatus }: {
  column: Column;
  items: RequestItem[];
  /** The column's size over the whole collections, when known. */
  total?: number;
  t: T;
  busy: Set<string>;
  dragging: RequestItem | null;
  onOpen: (item: RequestItem) => void;
  onSetStatus: (item: RequestItem, status: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const accepts = !!dragging && dragging.column !== column && targetStatus(dragging, column) !== null;
  const refuses = !!dragging && dragging.column !== column && !accepts;
  const id = `a3-col-${column}`;
  return (
    <section
      ref={setNodeRef}
      className={cn("a3-col", accepts && "a3-col-accepts", accepts && isOver && "a3-col-over", refuses && "a3-col-refuses")}
      aria-labelledby={id}
    >
      <header className="a3-col-head">
        <h2 id={id}>{columnLabel(column, t)}</h2>
        <span>{total ?? items.length}</span>
      </header>
      <div className="a3-col-list">
        {items.map((item) => (
          <BoardCard key={item.key} item={item} t={t} busy={busy.has(item.key)} onOpen={onOpen} onSetStatus={onSetStatus} />
        ))}
        {items.length === 0 && <p className="a3-col-empty">{t("conversions.board.emptyColumn")}</p>}
      </div>
    </section>
  );
}

function BoardCard({ item, t, busy, onOpen, onSetStatus }: {
  item: RequestItem;
  t: T;
  busy: boolean;
  onOpen: (item: RequestItem) => void;
  onSetStatus: (item: RequestItem, status: string) => void;
}) {
  const movable = item.kind !== "lead";
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: item.key, disabled: !movable || busy });
  return (
    <div ref={setNodeRef} {...listeners} className={cn("a3-card-slot", isDragging && "a3-card-ghost")}>
      <CardFace
        item={item}
        t={t}
        busy={busy}
        onOpen={onOpen}
        menu={
          <StatusMenu
            item={item}
            t={t}
            onSet={onSetStatus}
            trigger={<IconButton icon={MoreHorizontal} size="sm" className="a3-card-menu" label={`${t("conversions.board.changeStatus")}: ${item.name}`} />}
          />
        }
      />
    </div>
  );
}

function CardFace({ item, t, busy, overlay, onOpen, menu }: {
  item: RequestItem;
  t: T;
  busy?: boolean;
  overlay?: boolean;
  onOpen?: (item: RequestItem) => void;
  menu?: ReactNode;
}) {
  // Requests that wait on a person lead with the chat (mockup: Escalation > Apri chat).
  const chatFirst = item.kind === "escalation" && item.column !== "done" && item.conversationId;
  return (
    <article className={cn("a3-card", overlay && "a3-card-overlay", busy && "a3-card-busy")} aria-busy={busy || undefined}>
      <div className="a3-card-top">
        <KindTag kind={item.kind} t={t} />
        <span className="a3-sp" />
        <time className="a3-card-age" dateTime={item.createdAt}>{ageLabel(item.createdAt, t)}</time>
        {menu}
      </div>
      <h3 className="a3-card-name">
        {onOpen ? (
          <button type="button" className="a3-card-open" data-request-key={overlay ? undefined : item.key} onClick={() => onOpen(item)}>{item.name}</button>
        ) : item.name}
      </h3>
      {item.kind === "feedback" && item.rating != null && (
        <span className="a3-stars" aria-label={`${item.rating}/5`}>{stars(item.rating)}</span>
      )}
      {item.detail && <p className="a3-card-detail">{item.detail}</p>}
      {chatFirst && !overlay && (
        <div className="a3-card-actions">
          <Button asChild size="sm">
            <NavLink to="inbox/conversazioni" params={{ thread: String(item.conversationId) }}>{t("conversions.board.openChat")}</NavLink>
          </Button>
        </div>
      )}
    </article>
  );
}
