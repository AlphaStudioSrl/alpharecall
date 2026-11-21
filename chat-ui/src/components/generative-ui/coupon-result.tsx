import { CircleCheck, CircleX } from "lucide-react";
import { cardCopy } from "@/lib/card-copy";

interface CouponResultProps {
  component: {
    status?: string;
    tool?: string;
    title?: string;
    description?: string;
    lines?: Array<{ label: string; value: string }>;
  };
}

/** A discount code checked by the shop: valid with its discount, or why not. */
export function CouponResult({ component }: CouponResultProps) {
  const copy = cardCopy();
  const isValid = component.status === "valid";
  const code = component.lines?.find((l) => /^(code|codice)$/i.test(l.label))?.value || "";
  const discount = component.lines?.find((l) => /^(discount|sconto)$/i.test(l.label))?.value || "";

  return (
    <section className="ar-card ar-coupon-card" data-valid={isValid ? "true" : "false"} role="status">
      <div className="ar-card-head">
        {isValid
          ? <CircleCheck aria-hidden="true" className="ar-card-icon ar-card-icon--ok" />
          : <CircleX aria-hidden="true" className="ar-card-icon ar-card-icon--bad" />}
        <div className="ar-card-heading">
          <h3 className="ar-card-title">{isValid ? copy.couponValid : copy.couponInvalid}</h3>
          {component.description ? <p className="ar-card-sub">{component.description}</p> : null}
        </div>
      </div>
      {code || discount ? (
        <div className="ar-coupon-code">
          {code ? <code>{code}</code> : null}
          {discount ? <b>{discount}</b> : null}
        </div>
      ) : null}
    </section>
  );
}
