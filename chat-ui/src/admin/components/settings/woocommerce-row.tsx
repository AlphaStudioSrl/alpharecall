import { useEffect, useState } from "react";
import { useApp } from "@/admin/app-context";
import { apiFetch } from "@/admin/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Row, Status } from "@/admin/components/shared/kit";
import { WooCommerceSetup, type WooCommerceConnection } from "@/admin/components/integrations/woocommerce-setup";

/**
 * WooCommerce in Avanzate: one row that says whether the store is connected
 * and opens the switches (catalogue, order status, coupons, cart links).
 * The row is not shown on a site without WooCommerce, unless the connection
 * was left on there and has to be switched off.
 */
export function WooCommerceRow() {
  const { t, lang } = useApp();
  const [connection, setConnection] = useState<WooCommerceConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<WooCommerceConnection>("/integrations/woocommerce")
      .then((current) => alive && setConnection(current))
      .catch(() => alive && setConnection(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading || !connection) return null;
  if (!connection.plugin_detected && !connection.config.enabled) return null;

  const on = connection.plugin_detected && connection.config.enabled;
  return (
    <>
      <Row
        label="WooCommerce"
        description={t("advancedPage.wooDesc")}
      >
        {on && <Status tone="accent">{t("advancedPage.active")}</Status>}
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {on ? t("advancedPage.wooManage") : t("advancedPage.wooSetUp")}
        </Button>
      </Row>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>WooCommerce</DialogTitle>
            <DialogDescription>{t("advancedPage.wooDialogDesc")}</DialogDescription>
          </DialogHeader>
          <WooCommerceSetup
            locale={lang === "en" ? "en" : "it"}
            connection={connection}
            loading={false}
            onConnectionChange={(next) => next && setConnection(next)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
