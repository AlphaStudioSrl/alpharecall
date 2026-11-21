import * as React from "react"
import { createPortal } from "react-dom"

const ownerSelector = ".ar-chat-shell, .lp-root, #alpharecall-admin-app, [data-ar-portal]"

const DOMPortal = ({ children, container }: { children: React.ReactNode; container: Element | DocumentFragment }) => createPortal(children, container)

/** Keep portals outside clipping/transform containers without losing their
 * originating surface. A document-wide query cannot distinguish a preview,
 * public widget and admin running on the same WordPress page. */
export function SurfacePortal({ portal: Portal = DOMPortal, container, children, ...props }: {
  portal?: React.ElementType
  container?: Element | DocumentFragment | null
  children?: React.ReactNode
  forceMount?: true
}) {
  const anchor = React.useRef<HTMLSpanElement>(null)
  const [target, setTarget] = React.useState<HTMLElement | null>(null)

  React.useLayoutEffect(() => {
    const owner = anchor.current?.closest<HTMLElement>(ownerSelector)
    // Reuse the modal's owned layer for nested menus. Pre-creating a separate
    // body sibling lets Radix hideOthers mark an unopened select aria-hidden.
    if (!container && owner?.hasAttribute("data-ar-portal")) {
      setTarget(owner)
      return
    }
    const node = document.createElement("div")
    node.dataset.arPortal = ""
    // A layer opened from a widget surface (the visitor chat, the admin's
    // preview of it) keeps the widget's look, not the admin's focus ring.
    if (owner?.matches(".ar-chat-shell, .lp-root") || owner?.dataset.arPortalOwner === "widget") node.dataset.arPortalOwner = "widget"
    const sync = () => {
      if (!owner) return
      const style = getComputedStyle(owner)
      node.dataset.theme = owner.dataset.theme || (owner.id === "alpharecall-admin-app" ? "dark" : "light")
      // Includes tenant fills, neutral focus, font scaling and Radix tokens.
      for (const property of Array.from(style)) {
        if (property.startsWith("--")) node.style.setProperty(property, style.getPropertyValue(property))
      }
      node.style.fontFamily = style.fontFamily
      node.style.fontSize = style.fontSize
      node.style.lineHeight = style.lineHeight
      node.style.color = style.color
      node.style.colorScheme = style.colorScheme
    }
    sync()
    ;(container || document.body).appendChild(node)
    setTarget(node)
    const observer = new MutationObserver(sync)
    // Public tenant variables live on #alpharecall-chat-root, above the shell.
    for (let element = owner; element && element !== document.body; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ["style", "class", "data-theme"] })
    }
    // The layer outlives its content (a closed Dialog keeps it), so a modal
    // that opened meanwhile (a Sheet) has marked it aria-hidden through
    // hideOthers, and this portal's own hideOthers keeps its ancestors as they
    // are: the opened Dialog would be visible but absent for screen readers.
    // When content arrives, the layer is the newest surface: un-hide it. A
    // modal opened later still hides it as usual (only arrivals are handled).
    const reveal = new MutationObserver(() => {
      if (node.childElementCount > 0 && node.getAttribute("aria-hidden") === "true") node.removeAttribute("aria-hidden")
    })
    reveal.observe(node, { childList: true })
    return () => { observer.disconnect(); reveal.disconnect(); node.remove() }
  }, [container])

  return <>
    <span ref={anchor} hidden data-ar-portal-anchor="" />
    {target && <Portal {...props} container={target}>{children}</Portal>}
  </>
}
