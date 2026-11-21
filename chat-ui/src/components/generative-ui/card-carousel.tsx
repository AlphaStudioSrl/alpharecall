import * as React from "react";
import { cardCopy } from "@/lib/card-copy";
import { PRODUCT_LINK_EVENT } from "@/lib/product-format";

export type CarouselCard = {
  id: string;
  title: string;
  sub?: string;
  price?: string;
  image?: string;
  badge?: string;
  /** The small tinted button at the bottom right ("Chiedi", "Vedi"). */
  action?: { label: string; ariaLabel?: string; onClick?: () => void; href?: string };
  /**
   * The whole card opens this page (a product on the store). A page of this
   * site opens in the same tab, another site in a new one. The action then
   * only labels the link.
   */
  link?: { href: string; sameSite: boolean; ariaLabel?: string };
};

const safeHref = (value?: string) => {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * Swipeable service or product cards (Messenger "Listino e servizi"): the row
 * bleeds to the panel edge, snaps per card and shows where you are with dots.
 */
export function CardCarousel({ items, label }: { items: CarouselCard[]; label?: string }) {
  const copy = cardCopy();
  const scroller = React.useRef<HTMLUListElement>(null);
  const [page, setPage] = React.useState(0);
  const [pages, setPages] = React.useState(1);

  const measure = React.useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const width = el.clientWidth || 1;
    const count = Math.max(1, Math.ceil((el.scrollWidth - 4) / width));
    setPages(count);
    const atEnd = el.scrollLeft + width >= el.scrollWidth - 4;
    setPage(atEnd ? count - 1 : Math.round(el.scrollLeft / width));
  }, []);

  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [measure, items.length]);

  const goTo = (index: number) => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: index * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };

  if (!items.length) return null;

  return (
    <div className="ar-carousel">
      <ul ref={scroller} className="ar-carousel-track" aria-label={label || copy.carouselLabel}>
        {items.map((item) => {
          const href = safeHref(item.action?.href);
          const cardHref = safeHref(item.link?.href);
          if (item.link && cardHref) {
            const sameSite = item.link.sameSite;
            return (
              <li key={item.id} className="ar-carousel-card">
                <a
                  className="ar-carousel-link"
                  href={cardHref}
                  target={sameSite ? undefined : "_blank"}
                  rel={sameSite ? undefined : "noopener noreferrer"}
                  aria-label={item.link.ariaLabel}
                  draggable={false}
                  onClick={() => { if (sameSite) window.dispatchEvent(new CustomEvent(PRODUCT_LINK_EVENT, { detail: { href: cardHref } })); }}
                >
                  {item.image ? (
                    <img className="ar-carousel-img" src={item.image} alt="" loading="lazy" decoding="async" draggable={false} />
                  ) : null}
                  <span className="ar-carousel-body">
                    {item.badge ? <span className="ar-carousel-badge">{item.badge}</span> : null}
                    <b className="ar-carousel-title">{item.title}</b>
                    {item.sub ? <small className="ar-carousel-sub">{item.sub}</small> : null}
                    <span className="ar-carousel-foot">
                      {item.price ? <b className="ar-carousel-price">{item.price}</b> : <span />}
                      {item.action?.label ? <span className="ar-chip" aria-hidden="true">{item.action.label}</span> : null}
                    </span>
                  </span>
                </a>
              </li>
            );
          }
          return (
            <li key={item.id} className="ar-carousel-card">
              {item.image ? (
                <img className="ar-carousel-img" src={item.image} alt="" loading="lazy" decoding="async" draggable={false} />
              ) : null}
              <div className="ar-carousel-body">
                {item.badge ? <span className="ar-carousel-badge">{item.badge}</span> : null}
                <b className="ar-carousel-title">{item.title}</b>
                {item.sub ? <small className="ar-carousel-sub">{item.sub}</small> : null}
                {item.price || item.action ? (
                  <span className="ar-carousel-foot">
                    {item.price ? <b className="ar-carousel-price">{item.price}</b> : <span />}
                    {item.action && href ? (
                      <a className="ar-chip" href={href} target="_blank" rel="noopener noreferrer" aria-label={item.action.ariaLabel}>
                        {item.action.label}
                      </a>
                    ) : item.action?.onClick ? (
                      <button type="button" className="ar-chip" aria-label={item.action.ariaLabel} onClick={item.action.onClick}>
                        {item.action.label}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {pages > 1 ? (
        <div className="ar-dots">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" className="ar-dot" data-on={i === page ? "true" : undefined}
              aria-label={copy.carouselPage(i + 1, pages)} aria-current={i === page ? "true" : undefined}
              onClick={() => goTo(i)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
