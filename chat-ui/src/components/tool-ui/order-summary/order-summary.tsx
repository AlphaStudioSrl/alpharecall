import { CheckCircle, Package } from "@/components/icons";
import type { ReactElement } from "react";
import { cn } from "./_adapter";
import "../shared/tool-cards.css";
import type {
  OrderSummaryProps,
  OrderItem,
  Pricing,
  OrderDecision,
  OrderSummaryVariant,
} from "./schema";
import { widgetCopy } from "@/lib/widget-copy";

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatQuantity(quantity: number): string {
  return quantity === 1 ? "" : `× ${quantity}`;
}

function ItemImage({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return <Package aria-hidden="true" focusable="false" className="ar-order-icon" />;
  }
  return <img src={src} alt={alt} width={44} height={44} className="ar-order-thumb" />;
}

function OrderItemRow({
  item,
  currency,
}: {
  item: OrderItem;
  currency: string;
}) {
  const quantity = item.quantity ?? 1;
  const quantityText = formatQuantity(quantity);
  const hasDescription = item.description || quantityText;
  const lineTotal = item.unitPrice * quantity;

  return (
    <li className="ar-order-item">
      <ItemImage src={item.imageUrl} alt={item.name} />
      <div className="ar-order-item-text">
        <span className="ar-order-item-name">{item.name}</span>
        {hasDescription && (
          <span className="ar-order-item-sub">
            {[item.description, quantityText].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      <span className="ar-order-item-price">{formatCurrency(lineTotal, currency)}</span>
    </li>
  );
}

function PricingBreakdown({
  pricing,
  className,
}: {
  pricing: Pricing;
  className?: string;
}) {
  const currency = pricing.currency ?? "USD";

  return (
    <dl className={cn("ar-order-totals", className)}>
      <div>
        <dt>{widgetCopy().subtotal}</dt>
        <dd>{formatCurrency(pricing.subtotal, currency)}</dd>
      </div>

      {pricing.discount !== undefined && pricing.discount > 0 && (
        <div data-tone="good">
          <dt>{pricing.discountLabel || widgetCopy().discount}</dt>
          <dd>-{formatCurrency(pricing.discount, currency)}</dd>
        </div>
      )}

      {pricing.shipping !== undefined && (
        <div>
          <dt>{widgetCopy().shipping}</dt>
          <dd>
            {pricing.shipping === 0
              ? widgetCopy().free
              : formatCurrency(pricing.shipping, currency)}
          </dd>
        </div>
      )}

      {pricing.tax !== undefined && (
        <div>
          <dt>{pricing.taxLabel || widgetCopy().tax}</dt>
          <dd>{formatCurrency(pricing.tax, currency)}</dd>
        </div>
      )}

      <div className="ar-order-total">
        <dt>{widgetCopy().total}</dt>
        <dd>{formatCurrency(pricing.total, currency)}</dd>
      </div>
    </dl>
  );
}

function formatDate(isoString: string): string | undefined {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return undefined;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return undefined;
  }
}

function receiptLine(orderId?: string, confirmedAt?: string): string | null {
  const formattedDate = confirmedAt ? formatDate(confirmedAt) : undefined;
  const parts = [orderId && `#${orderId}`, formattedDate].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function OrderSummaryRoot({
  id,
  title = widgetCopy().orderSummary,
  variant,
  items,
  pricing,
  choice,
  className,
}: OrderSummaryProps) {
  const titleId = `${id}-title`;
  const resolvedVariant: OrderSummaryVariant =
    variant ?? (choice === undefined ? "summary" : "receipt");
  const isReceipt = resolvedVariant === "receipt";
  const isMalformedPayload =
    !Array.isArray(items) ||
    items.length === 0 ||
    pricing == null ||
    (isReceipt && choice === undefined);

  if (isMalformedPayload) {
    return (
      <section
        data-slot="order-summary"
        data-tool-ui-id={id}
        aria-labelledby={titleId}
        className={cn("ar-card ar-order-card", className)}
      >
        <div className="ar-card-head">
          <Package aria-hidden="true" focusable="false" className="ar-card-icon" />
          <div className="ar-card-heading">
            <h3 id={titleId} className="ar-card-title">{title}</h3>
            <p className="ar-card-sub">{widgetCopy().orderSummaryError}</p>
          </div>
        </div>
      </section>
    );
  }

  const sub = isReceipt && choice ? receiptLine(choice.orderId, choice.confirmedAt) : null;

  return (
    <section
      data-slot="order-summary"
      data-tool-ui-id={id}
      data-variant={resolvedVariant}
      aria-labelledby={titleId}
      className={cn("ar-card ar-order-card", className)}
    >
      <div className="ar-card-head">
        {isReceipt ? (
          <CheckCircle aria-hidden="true" focusable="false" className="ar-card-icon ar-order-ok" />
        ) : (
          <Package aria-hidden="true" focusable="false" className="ar-card-icon" />
        )}
        <div className="ar-card-heading">
          <h3 id={titleId} className="ar-card-title">{title}</h3>
          {sub && <p className="ar-card-sub">{sub}</p>}
        </div>
      </div>

      <ul className="ar-order-items">
        {items.map((item) => (
          <OrderItemRow
            key={item.id}
            item={item}
            currency={pricing.currency ?? "USD"}
          />
        ))}
      </ul>

      <PricingBreakdown pricing={pricing} />
    </section>
  );
}

export type OrderSummaryDisplayProps = OrderSummaryProps;

function OrderSummaryDisplay(props: OrderSummaryDisplayProps) {
  return <OrderSummaryRoot {...props} variant="summary" />;
}

export interface OrderSummaryReceiptProps extends Omit<
  OrderSummaryProps,
  "choice"
> {
  choice: OrderDecision;
}

function OrderSummaryReceipt(props: OrderSummaryReceiptProps) {
  return <OrderSummaryRoot {...props} variant="receipt" />;
}

export interface OrderSummaryCompoundComponent {
  (props: OrderSummaryProps): ReactElement;
  Display: (props: OrderSummaryDisplayProps) => ReactElement;
  Receipt: (props: OrderSummaryReceiptProps) => ReactElement;
}

export const OrderSummary: OrderSummaryCompoundComponent = Object.assign(
  OrderSummaryRoot,
  {
    Display: OrderSummaryDisplay,
    Receipt: OrderSummaryReceipt,
  },
);
