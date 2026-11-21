/**
 * Richieste as a list: every type in one soft table (mockup richieste A),
 * the improved version of the four tables the page used to have. A row opens
 * the sheet; status and delete stay one click away on the row.
 */
import { Avatar, IconButton, SoftCell, SoftRow, SoftTable, Status } from "@/admin/components/shared/kit";
import { ChevronDown, Trash2 } from "@/components/icons";
import { KindTag, StatusMenu, stageLabel, stageTone } from "./parts";
import { ageLabel, type RequestItem } from "./request-model";

type T = (key: string) => string;

export function RequestList({ items, t, busy, onOpen, onSetStatus, onDelete, canDelete }: {
  items: RequestItem[];
  t: T;
  busy: Set<string>;
  onOpen: (item: RequestItem) => void;
  onSetStatus: (item: RequestItem, status: string) => void;
  onDelete: (item: RequestItem) => void;
  canDelete: (item: RequestItem) => boolean;
}) {
  return (
    <div data-tour="conversions-table" className="a3-list">
      <SoftTable label={t("conversions.board.title")} columns="var(--a3-list-cols)">
        <SoftRow head>
          <SoftCell head>{t("conversions.type")}</SoftCell>
          <SoftCell head>{t("conversions.board.person")}</SoftCell>
          <SoftCell head>{t("conversions.board.detail")}</SoftCell>
          <SoftCell head>{t("labels.status")}</SoftCell>
          <SoftCell head>{t("conversions.board.when")}</SoftCell>
          <SoftCell head><span className="sr-only">{t("common.actions")}</span></SoftCell>
        </SoftRow>
        {items.map((item) => {
          // The stage (Nuova, In corso, Fatta), as on the board; a lead keeps its email state.
          const status = stageLabel(item.kind, item.status, t);
          const label = item.kind === "lead" ? item.email || `#${item.id}` : item.name || item.email || `#${Math.abs(item.id)}`;
          return (
            <SoftRow key={item.key} dataKey={item.key} onClick={() => onOpen(item)} className={busy.has(item.key) ? "a3-row-busy" : undefined}>
              <SoftCell><KindTag kind={item.kind} t={t} /></SoftCell>
              <div role="cell" className="ark-td ark-who">
                {item.person ? <Avatar name={item.person} size="s" /> : <span className="a3-av-none" aria-hidden="true" />}
                <span>
                  <b className={item.person ? undefined : "a3-faint"}>{item.person || (item.kind === "feedback" ? t("conversions.anonymous") : t("conversions.board.visitor"))}</b>
                  {item.email && item.email !== item.person && <small>{item.email}</small>}
                </span>
              </div>
              <SoftCell className="a3-list-detail">{(item.kind === "escalation" ? item.name : item.detail) || "–"}</SoftCell>
              <SoftCell>
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <StatusMenu
                    item={item}
                    t={t}
                    align="start"
                    onSet={onSetStatus}
                    trigger={
                      <button type="button" className="a3-status-btn" aria-label={`${t("conversions.board.changeStatus")}: ${label}, ${status}`}>
                        <Status tone={stageTone(item.kind, item.status)}>{status}</Status>
                        <ChevronDown aria-hidden="true" />
                      </button>
                    }
                  />
                </span>
                {item.kind === "lead" && <Status tone={stageTone(item.kind, item.status)}>{status}</Status>}
              </SoftCell>
              <SoftCell className="a3-faint">{ageLabel(item.createdAt, t)}</SoftCell>
              <SoftCell className="a3-list-actions">
                {canDelete(item) && (
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={`${t("conversions.delete")} ${label}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
              </SoftCell>
            </SoftRow>
          );
        })}
      </SoftTable>
    </div>
  );
}
