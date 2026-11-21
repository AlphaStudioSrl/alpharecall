import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Trash2 } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/admin/app-context";
import { Bones } from "@/admin/components/shared/bones";

interface Column {
  key: string;
  label: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, unknown>[];
  loading?: boolean;
  emptyMessage?: string;
  onDelete?: (id: string) => void;
  /** Bone registry key. Distinct per table -- see DataTable's body. */
  bonesName?: string;
}

export function DataTable({
  columns,
  data,
  loading,
  emptyMessage,
  onDelete,
  bonesName,
}: DataTableProps) {
  const { t } = useApp();

  // Each table has its own columns and row height, so callers pass their own
  // bone name -- one shared name would give every table the same placeholder.
  return (
    <Bones
      name={bonesName ?? "tools-table"}
      loading={Boolean(loading)}
      fallback={
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      }
    >
      {!data.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {emptyMessage || t("messages.noData")}
        </p>
      ) : (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key}>{col.label}</TableHead>
          ))}
          {onDelete && <TableHead className="w-12"><span className="sr-only">{t("common.actions")}</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, idx) => (
          <TableRow key={(row.id as string) || idx}>
            {columns.map((col) => (
              <TableCell key={col.key}>
                {col.render
                  ? col.render(row[col.key], row)
                  : String(row[col.key] ?? "-")}
              </TableCell>
            ))}
            {onDelete && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(row.id as string)}
                  aria-label={t("buttons.delete")}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
      )}
    </Bones>
  );
}
