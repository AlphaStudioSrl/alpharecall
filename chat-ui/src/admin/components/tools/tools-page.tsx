import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/admin/app-context";
import { useTools } from "@/admin/hooks/use-tools";
import { DataTable } from "./data-table";
import { formatDate } from "@/admin/lib/format";
import type { ToolsTab } from "@/admin/lib/config";
import { getInitialToolsTab } from "@/admin/lib/config";
import {
  appointmentEmail,
  appointmentName,
  appointmentTime,
  leadConsent,
  leadName,
  statusLabel,
} from "@/admin/lib/record-fields";

type Row = Record<string, unknown>;

export function ToolsPage() {
  const { t } = useApp();
  const [activeTab, setActiveTab] = useState<ToolsTab>(getInitialToolsTab);
  const { appointments, leads, escalations, products, loading, deleteItem } = useTools();

  // Rows are the raw API records (app/schemas.py); the readers are shared
  // with Registro Attività so both pages show the same values.
  const statusBadge = (v: unknown, fallback: string) => (
    <Badge variant="secondary">{statusLabel(t, String(v || fallback))}</Badge>
  );
  const dateCell = (v: string) => (v ? formatDate(v) : "\u2014");
  const dash = (v: string) => v || "\u2014";

  const appointmentColumns = [
    { key: "name", label: t("labels.name"), render: (_: unknown, row: Row) => dash(appointmentName(row)) },
    { key: "email", label: t("labels.email"), render: (_: unknown, row: Row) => dash(appointmentEmail(row)) },
    { key: "timeslot", label: t("labels.date"), render: (_: unknown, row: Row) => dateCell(appointmentTime(row)) },
    { key: "status", label: t("labels.status"), render: (v: unknown) => statusBadge(v, "scheduled") },
  ];

  const leadColumns = [
    { key: "name", label: t("labels.name"), render: (_: unknown, row: Row) => dash(leadName(row)) },
    { key: "email", label: t("labels.email") },
    {
      key: "consent",
      label: t("labels.consent"),
      render: (_: unknown, row: Row) => (
        <Badge variant={leadConsent(row) ? "default" : "secondary"}>
          {leadConsent(row) ? t("badges.consented") : t("badges.notConsented")}
        </Badge>
      ),
    },
    { key: "created_at", label: t("labels.date"), render: (v: unknown) => dateCell(String(v || "")) },
  ];

  const escalationColumns = [
    { key: "issue", label: t("labels.reason"), render: (v: unknown) => dash(String(v || "")) },
    { key: "status", label: t("labels.status"), render: (v: unknown) => statusBadge(v, "pending") },
    { key: "created_at", label: t("labels.date"), render: (v: unknown) => dateCell(String(v || "")) },
  ];

  const productColumns = [
    { key: "query", label: t("labels.search") },
    { key: "product_name", label: t("labels.product") },
    { key: "source", label: t("labels.source") },
    {
      key: "created_at",
      label: t("labels.date"),
      render: (v: unknown) => (v ? formatDate(String(v)) : "\u2014"),
    },
  ];

  return (
    <Card>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ToolsTab)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("section.toolsTitle")}</CardTitle>
            <TabsList data-tour="tools-tabs">
              <TabsTrigger value="appointments">
                {t("nav.appointments")}
              </TabsTrigger>
              <TabsTrigger value="leads">{t("nav.leads")}</TabsTrigger>
              <TabsTrigger value="escalations">
                {t("nav.escalations")}
              </TabsTrigger>
              <TabsTrigger value="products">{t("nav.products")}</TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent data-tour="tools-table">
          <TabsContent value="appointments" className="mt-0">
            <DataTable
              columns={appointmentColumns}
              data={appointments as Record<string, unknown>[]}
              loading={loading.appointments}
              bonesName="tools-appointments"
              emptyMessage={t("messages.noData")}
              onDelete={(id) => deleteItem("appointments", id)}
            />
          </TabsContent>
          <TabsContent value="leads" className="mt-0">
            <DataTable
              columns={leadColumns}
              data={leads as Record<string, unknown>[]}
              loading={loading.leads}
              bonesName="tools-leads"
              emptyMessage={t("messages.noData")}
              onDelete={(id) => deleteItem("leads", id)}
            />
          </TabsContent>
          <TabsContent value="escalations" className="mt-0">
            <DataTable
              columns={escalationColumns}
              data={escalations as Record<string, unknown>[]}
              loading={loading.escalations}
              bonesName="tools-escalations"
              emptyMessage={t("messages.noData")}
            />
          </TabsContent>
          <TabsContent value="products" className="mt-0">
            <DataTable
              columns={productColumns}
              data={products as Record<string, unknown>[]}
              loading={loading.products}
              bonesName="tools-products"
              emptyMessage={t("messages.noProducts")}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
