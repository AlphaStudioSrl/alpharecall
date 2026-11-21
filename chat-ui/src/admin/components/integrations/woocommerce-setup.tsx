import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/admin/lib/api";

export type WooCommerceConnection = {
  slug: "woocommerce";
  status: string;
  plugin_detected: boolean;
  plugin_version: string | null;
  store_url: string;
  currency: string | null;
  hpos_enabled: boolean;
  product_count: number;
  config: WooCommerceConfig;
  queue_count: number;
  last_delivery_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  delivered_count: number;
  failed_count: number;
};

type WooCommerceConfig = {
  enabled: boolean;
  sync_products: boolean;
  sync_order_events: boolean;
  order_lookup: boolean;
  coupon_validation: boolean;
  cart_links: boolean;
  default_page_size: number;
  cache_ttl_seconds: number;
};

type SyncStatus = {
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_product_count: number | null;
};

type Props = {
  locale: "it" | "en";
  connection: WooCommerceConnection | null;
  loading: boolean;
  onConnectionChange: (connection: WooCommerceConnection | null) => void;
};

const defaults: WooCommerceConfig = {
  enabled: false,
  sync_products: true,
  sync_order_events: true,
  order_lookup: true,
  coupon_validation: true,
  cart_links: true,
  default_page_size: 10,
  cache_ttl_seconds: 300,
};

export function WooCommerceSetup({ locale, connection, loading, onConnectionChange }: Props) {
  const en = locale === "en";
  const [draft, setDraft] = useState<WooCommerceConfig>(connection?.config || defaults);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => setDraft(connection?.config || defaults), [connection]);

  useEffect(() => {
    if (!connection?.plugin_detected || !connection.config.enabled) return;
    void apiFetch<SyncStatus>("/integrations/woocommerce/sync-status")
      .then(setSyncStatus)
      .catch(() => undefined);
  }, [connection?.config.enabled, connection?.last_success_at]);

  const fail = (cause: unknown, fallback: string) => {
    toast.error(cause instanceof Error ? cause.message : fallback);
  };

  const save = async () => {
    setBusy("save");
    try {
      const result = await apiFetch<WooCommerceConnection>("/integrations/woocommerce", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onConnectionChange(result);
      toast.success(en ? "WooCommerce settings saved." : "Impostazioni WooCommerce salvate.");
    } catch (cause) {
      fail(cause, en ? "Couldn't save your settings." : "Non è stato possibile salvare le impostazioni.");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await apiFetch("/integrations/woocommerce/test", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      toast.success(en ? "Store API access is working." : "L'accesso alla Store API funziona.");
    } catch (cause) {
      fail(cause, en ? "The connection test didn't work." : "Il test della connessione non è riuscito.");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await apiFetch("/integrations/woocommerce/sync", { method: "POST" });
      setSyncStatus(await apiFetch<SyncStatus>("/integrations/woocommerce/sync-status"));
      toast.success(en ? "Product sync started." : "Sincronizzazione dei prodotti avviata.");
    } catch (cause) {
      fail(cause, en ? "Couldn't start the product sync." : "Non è stato possibile avviare la sincronizzazione.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(en ? "Disconnect WooCommerce? Events still waiting to be sent will be cleared." : "Vuoi scollegare WooCommerce? Gli eventi ancora da inviare verranno cancellati.")) return;
    setBusy("disconnect");
    try {
      const result = await apiFetch<WooCommerceConnection>("/integrations/woocommerce", { method: "DELETE" });
      onConnectionChange(result);
      setSyncStatus(null);
      toast.success(en ? "WooCommerce disconnected." : "WooCommerce scollegato.");
    } catch (cause) {
      fail(cause, en ? "Couldn't disconnect." : "Non è stato possibile scollegare.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="min-h-32 animate-pulse rounded-lg bg-muted" aria-label={en ? "Loading your WooCommerce settings" : "Carico le impostazioni di WooCommerce"} />;
  }

  if (!connection?.plugin_detected) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
        <p className="font-medium text-destructive">{en ? "WooCommerce isn't active" : "WooCommerce non è attivo"}</p>
        <p className="mt-1 text-muted-foreground">
          {en ? "Install and activate WooCommerce on this WordPress site, then reopen this panel." : "Installa e attiva WooCommerce su questo sito WordPress, poi riapri questo pannello."}
        </p>
        {connection?.config.enabled ? (
          <Button className="mt-4 min-h-11" variant="destructive" disabled={busy !== null} onClick={() => void disconnect()}>
            {busy === "disconnect" ? (en ? "Disconnecting..." : "Disconnessione...") : (en ? "Disconnect" : "Disconnetti")}
          </Button>
        ) : null}
      </div>
    );
  }

  const switches: Array<[keyof WooCommerceConfig, string, string]> = [
    ["enabled", en ? "Enable WooCommerce" : "Abilita WooCommerce", en ? "Turns on the connector, with automatic retries." : "Attiva il connettore, con nuovi tentativi automatici."],
    ["sync_products", en ? "Product catalog sync" : "Sincronizzazione catalogo", en ? "Indexes your public products and keeps them up to date." : "Indicizza i prodotti pubblici e li tiene aggiornati."],
    ["sync_order_events", en ? "Privacy-safe order events" : "Eventi ordine senza dati personali", en ? "Only sends the order status and summary totals." : "Invia solo lo stato dell'ordine e i totali riepilogativi."],
    ["order_lookup", en ? "Order status with verification" : "Stato ordine con verifica", en ? "Shows the status only after the customer gives the exact email used at checkout." : "Mostra lo stato solo dopo che il cliente ha indicato l'email esatta usata al checkout."],
    ["coupon_validation", en ? "Coupon validation" : "Verifica coupon", en ? "Checks in WooCommerce, in real time, whether a coupon is valid." : "Controlla in tempo reale su WooCommerce se un coupon è valido."],
    ["cart_links", en ? "Safe cart links" : "Link sicuri al carrello", en ? "Creates links the customer confirms, without touching anyone's cart on the server." : "Crea link che il cliente conferma, senza toccare il carrello sul server."],
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2">
        <div><span className="text-muted-foreground">{en ? "Store" : "Negozio"}</span><p className="break-all font-medium">{connection.store_url}</p></div>
        <div><span className="text-muted-foreground">WooCommerce</span><p className="font-medium">{connection.plugin_version || "-"} {connection.hpos_enabled ? "- HPOS" : ""}</p></div>
        <div><span className="text-muted-foreground">{en ? "Published products" : "Prodotti pubblicati"}</span><p className="font-medium">{connection.product_count}</p></div>
        <div><span className="text-muted-foreground">{en ? "Waiting to send" : "In attesa di invio"}</span><p className="font-medium">{connection.queue_count}</p></div>
      </div>

      <div className="space-y-3">
        {switches.map(([key, label, description]) => (
          <div key={key} className="flex min-h-11 items-center justify-between gap-4 rounded-lg border p-3">
            <div><Label htmlFor={`woo-${key}`}>{label}</Label><p className="text-xs text-muted-foreground">{description}</p></div>
            <Switch
              id={`woo-${key}`}
              checked={Boolean(draft[key])}
              disabled={busy !== null}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, [key]: checked }))}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="woo-page-size">{en ? "Products per answer" : "Prodotti per risposta"}</Label>
          <Input id="woo-page-size" type="number" min={1} max={100} value={draft.default_page_size} onChange={(event) => setDraft((current) => ({ ...current, default_page_size: Number(event.target.value) || 1 }))} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="woo-cache-ttl">{en ? "Live data cache (seconds)" : "Cache dei dati in tempo reale (secondi)"}</Label>
          <Input id="woo-cache-ttl" type="number" min={30} max={86400} value={draft.cache_ttl_seconds} onChange={(event) => setDraft((current) => ({ ...current, cache_ttl_seconds: Number(event.target.value) || 30 }))} />
        </div>
      </div>

      {(connection.last_error || syncStatus?.last_sync_status) && (
        <div className="rounded-lg border p-3 text-xs" role={connection.last_error ? "alert" : "status"}>
          {connection.last_error ? <p className="text-destructive">{connection.last_error}</p> : null}
          {syncStatus?.last_sync_status ? <p>{en ? "Last catalog sync" : "Ultima sincronizzazione del catalogo"}: {syncStatus.last_sync_status} ({syncStatus.last_sync_product_count ?? 0})</p> : null}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? (en ? "Saving..." : "Salvataggio...") : (en ? "Save settings" : "Salva impostazioni")}</Button>
        <Button className="min-h-11" variant="outline" disabled={busy !== null} onClick={() => void test()}>{busy === "test" ? (en ? "Testing..." : "Test...") : (en ? "Test connection" : "Verifica connessione")}</Button>
        <Button className="min-h-11" variant="outline" disabled={busy !== null || !draft.enabled || !draft.sync_products} onClick={() => void sync()}>{busy === "sync" ? (en ? "Starting..." : "Avvio...") : (en ? "Sync products" : "Sincronizza prodotti")}</Button>
        <Button className="min-h-11" variant="destructive" disabled={busy !== null || !connection.config.enabled} onClick={() => void disconnect()}>{busy === "disconnect" ? (en ? "Disconnecting..." : "Disconnessione...") : (en ? "Disconnect" : "Disconnetti")}</Button>
      </div>
    </div>
  );
}
