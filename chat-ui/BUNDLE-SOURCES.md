# What each built script is made from

Written by the build (`build-tools/record-bundle-contents.ts`). For every script in
`assets/js`: the files of this folder it was compiled from, then the npm packages
compiled into it. The packages' own source repositories are listed in the plugin's
`readme.txt` ("Third-party libraries"), their licences in `THIRD-PARTY-LICENSES.md`.
`assets/css/chat.css` and `assets/css/admin.css` are compiled by the same two builds
from the stylesheets that `src/main.tsx` and `src/admin/main.tsx` import (`src/index.css`,
`src/widget-design.css`, `src/admin/admin.css` and the files they include), with
Tailwind CSS (`tailwind.config.ts`, `tailwind.admin.config.ts`).

`assets/js/admin.js` is a few readable lines that load the dashboard's first script;
`assets/js/report.js` and `assets/css/report.css` are written by hand.

## assets/js/chat.js

Source files:

- `chat-ui/src/app.tsx`
- `chat-ui/src/components/ai-elements/shimmer.tsx`
- `chat-ui/src/components/chat-tab-nav.tsx`
- `chat-ui/src/components/chat/ai-disclosure.tsx`
- `chat-ui/src/components/chat/attachments.tsx`
- `chat-ui/src/components/chat/header-menu.tsx`
- `chat-ui/src/components/chat/presentation.tsx`
- `chat-ui/src/components/chat/sheet.tsx`
- `chat-ui/src/components/chat/tool-slot.tsx`
- `chat-ui/src/components/consent-card.tsx`
- `chat-ui/src/components/faq-tab.tsx`
- `chat-ui/src/components/generative-ui/appointment-slots.tsx`
- `chat-ui/src/components/generative-ui/card-carousel.tsx`
- `chat-ui/src/components/generative-ui/clarify-prompt.tsx`
- `chat-ui/src/components/generative-ui/coupon-result.tsx`
- `chat-ui/src/components/generative-ui/event-cards.tsx`
- `chat-ui/src/components/generative-ui/feedback-sheet.tsx`
- `chat-ui/src/components/generative-ui/handoff-card.tsx`
- `chat-ui/src/components/generative-ui/info-card.tsx`
- `chat-ui/src/components/generative-ui/message-rating.tsx`
- `chat-ui/src/components/generative-ui/radio-keys.ts`
- `chat-ui/src/components/generative-ui/table-card.tsx`
- `chat-ui/src/components/icons/animated/arrow-left.tsx`
- `chat-ui/src/components/icons/animated/arrow-right.tsx`
- `chat-ui/src/components/icons/animated/arrow-up.tsx`
- `chat-ui/src/components/icons/animated/at-sign.tsx`
- `chat-ui/src/components/icons/animated/bell.tsx`
- `chat-ui/src/components/icons/animated/bot.tsx`
- `chat-ui/src/components/icons/animated/brain.tsx`
- `chat-ui/src/components/icons/animated/calendar-days.tsx`
- `chat-ui/src/components/icons/animated/chart-pie.tsx`
- `chat-ui/src/components/icons/animated/check-check.tsx`
- `chat-ui/src/components/icons/animated/check.tsx`
- `chat-ui/src/components/icons/animated/chevron-down.tsx`
- `chat-ui/src/components/icons/animated/chevron-left.tsx`
- `chat-ui/src/components/icons/animated/chevron-right.tsx`
- `chat-ui/src/components/icons/animated/chevron-up.tsx`
- `chat-ui/src/components/icons/animated/clock.tsx`
- `chat-ui/src/components/icons/animated/contrast.tsx`
- `chat-ui/src/components/icons/animated/copy.tsx`
- `chat-ui/src/components/icons/animated/credit-card.tsx`
- `chat-ui/src/components/icons/animated/download.tsx`
- `chat-ui/src/components/icons/animated/eye-off.tsx`
- `chat-ui/src/components/icons/animated/eye.tsx`
- `chat-ui/src/components/icons/animated/file-text.tsx`
- `chat-ui/src/components/icons/animated/flame.tsx`
- `chat-ui/src/components/icons/animated/folder-minus.tsx`
- `chat-ui/src/components/icons/animated/folder-open.tsx`
- `chat-ui/src/components/icons/animated/folder-plus.tsx`
- `chat-ui/src/components/icons/animated/folder-sync.tsx`
- `chat-ui/src/components/icons/animated/grip-vertical.tsx`
- `chat-ui/src/components/icons/animated/hand-metal.tsx`
- `chat-ui/src/components/icons/animated/languages.tsx`
- `chat-ui/src/components/icons/animated/layout-grid.tsx`
- `chat-ui/src/components/icons/animated/layout-panel-top.tsx`
- `chat-ui/src/components/icons/animated/linkedin.tsx`
- `chat-ui/src/components/icons/animated/lock.tsx`
- `chat-ui/src/components/icons/animated/map-pin.tsx`
- `chat-ui/src/components/icons/animated/message-circle.tsx`
- `chat-ui/src/components/icons/animated/message-square.tsx`
- `chat-ui/src/components/icons/animated/mic.tsx`
- `chat-ui/src/components/icons/animated/moon.tsx`
- `chat-ui/src/components/icons/animated/phone.tsx`
- `chat-ui/src/components/icons/animated/plus.tsx`
- `chat-ui/src/components/icons/animated/receipt-text.tsx`
- `chat-ui/src/components/icons/animated/refresh-cw.tsx`
- `chat-ui/src/components/icons/animated/rotate-ccw.tsx`
- `chat-ui/src/components/icons/animated/scan-text.tsx`
- `chat-ui/src/components/icons/animated/search.tsx`
- `chat-ui/src/components/icons/animated/send.tsx`
- `chat-ui/src/components/icons/animated/settings.tsx`
- `chat-ui/src/components/icons/animated/shield-check.tsx`
- `chat-ui/src/components/icons/animated/sparkles.tsx`
- `chat-ui/src/components/icons/animated/sun.tsx`
- `chat-ui/src/components/icons/animated/trending-down.tsx`
- `chat-ui/src/components/icons/animated/trending-up.tsx`
- `chat-ui/src/components/icons/animated/twitter.tsx`
- `chat-ui/src/components/icons/animated/upload.tsx`
- `chat-ui/src/components/icons/animated/user.tsx`
- `chat-ui/src/components/icons/animated/users.tsx`
- `chat-ui/src/components/icons/animated/wifi.tsx`
- `chat-ui/src/components/icons/animated/wrench.tsx`
- `chat-ui/src/components/icons/animated/x.tsx`
- `chat-ui/src/components/icons/animated/zap.tsx`
- `chat-ui/src/components/icons/index.ts`
- `chat-ui/src/components/pre-chat-form.tsx`
- `chat-ui/src/components/safe-markdown.tsx`
- `chat-ui/src/components/tambo/base/message/content/message-content.tsx`
- `chat-ui/src/components/tambo/base/message/images/message-images.tsx`
- `chat-ui/src/components/tambo/base/message/index.tsx`
- `chat-ui/src/components/tambo/base/message/loading-indicator/message-loading-indicator.tsx`
- `chat-ui/src/components/tambo/base/message/rendered-component/rendered-component-canvas-button.tsx`
- `chat-ui/src/components/tambo/base/message/rendered-component/rendered-component-content.tsx`
- `chat-ui/src/components/tambo/base/message/rendered-component/rendered-component.tsx`
- `chat-ui/src/components/tambo/base/message/root/message-root-context.tsx`
- `chat-ui/src/components/tambo/base/message/root/message-root.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/content/reasoning-info-content.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/index.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/root/reasoning-info-context.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/root/reasoning-info-root.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/status-text/reasoning-info-status-text.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/steps/reasoning-info-steps.tsx`
- `chat-ui/src/components/tambo/base/reasoning-info/trigger/reasoning-info-trigger.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/content/toolcall-info-content.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/index.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/parameters/toolcall-info-parameters.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/result/toolcall-info-result.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/root/get-tool-call-request.ts`
- `chat-ui/src/components/tambo/base/toolcall-info/root/get-tool-status-message.ts`
- `chat-ui/src/components/tambo/base/toolcall-info/root/keyify-parameters.ts`
- `chat-ui/src/components/tambo/base/toolcall-info/root/toolcall-info-context.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/root/toolcall-info-root.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/status-icon/toolcall-info-status-icon.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/status-text/toolcall-info-status-text.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/tool-name/toolcall-info-tool-name.tsx`
- `chat-ui/src/components/tambo/base/toolcall-info/trigger/toolcall-info-trigger.tsx`
- `chat-ui/src/components/tambo/base/use-render/use-render.ts`
- `chat-ui/src/components/tambo/markdown-components.tsx`
- `chat-ui/src/components/tambo/message-thread-full.tsx`
- `chat-ui/src/components/tambo/message.tsx`
- `chat-ui/src/components/tambo/thread-container.tsx`
- `chat-ui/src/components/tambo/tool-generative-renderer.tsx`
- `chat-ui/src/components/tool-ui/chart/chart.tsx`
- `chat-ui/src/components/tool-ui/data-table/data-table.tsx`
- `chat-ui/src/components/tool-ui/data-table/formatters.tsx`
- `chat-ui/src/components/tool-ui/data-table/utilities.ts`
- `chat-ui/src/components/tool-ui/geo-map/basemap-layer.tsx`
- `chat-ui/src/components/tool-ui/geo-map/geo-map-engine.tsx`
- `chat-ui/src/components/tool-ui/geo-map/geo-map-hours.ts`
- `chat-ui/src/components/tool-ui/geo-map/geo-map-icons.ts`
- `chat-ui/src/components/tool-ui/geo-map/geo-map-overlays.tsx`
- `chat-ui/src/components/tool-ui/geo-map/geo-map-theme.module.css`
- `chat-ui/src/components/tool-ui/geo-map/geo-map.tsx`
- `chat-ui/src/components/tool-ui/geo-map/leaflet-react.tsx`
- `chat-ui/src/components/tool-ui/item-carousel/item-card.tsx`
- `chat-ui/src/components/tool-ui/item-carousel/item-carousel.tsx`
- `chat-ui/src/components/tool-ui/message-draft/message-draft.tsx`
- `chat-ui/src/components/tool-ui/message-draft/request-draft.tsx`
- `chat-ui/src/components/tool-ui/order-summary/order-summary.tsx`
- `chat-ui/src/components/tool-ui/question-flow/question-flow.tsx`
- `chat-ui/src/components/tool-ui/shared/media/aspect-ratio.ts`
- `chat-ui/src/components/tool-ui/shared/media/safe-navigation.ts`
- `chat-ui/src/components/tool-ui/shared/media/sanitize-href.ts`
- `chat-ui/src/components/tool-ui/shared/utils.ts`
- `chat-ui/src/components/tool-ui/stats-display/sparkline.tsx`
- `chat-ui/src/components/tool-ui/stats-display/stats-display.tsx`
- `chat-ui/src/components/ui/accordion.tsx`
- `chat-ui/src/components/ui/badge.tsx`
- `chat-ui/src/components/ui/button.tsx`
- `chat-ui/src/components/ui/card.tsx`
- `chat-ui/src/components/ui/chart.tsx`
- `chat-ui/src/components/ui/dropdown-menu.tsx`
- `chat-ui/src/components/ui/separator.tsx`
- `chat-ui/src/components/ui/surface-portal.tsx`
- `chat-ui/src/components/ui/table.tsx`
- `chat-ui/src/components/ui/tooltip.tsx`
- `chat-ui/src/followups.tsx`
- `chat-ui/src/hooks/use-visitor-identity.ts`
- `chat-ui/src/lib/active-tab-color.ts`
- `chat-ui/src/lib/brand-color.ts`
- `chat-ui/src/lib/card-copy.ts`
- `chat-ui/src/lib/chat-attachments.ts`
- `chat-ui/src/lib/consent-send-gate.ts`
- `chat-ui/src/lib/consent-storage.ts`
- `chat-ui/src/lib/device-id.ts`
- `chat-ui/src/lib/dock-slot.ts`
- `chat-ui/src/lib/handoff-contact.ts`
- `chat-ui/src/lib/header-identity.ts`
- `chat-ui/src/lib/host-theme.ts`
- `chat-ui/src/lib/map-tiles.ts`
- `chat-ui/src/lib/maps-runtime.ts`
- `chat-ui/src/lib/message-limit.ts`
- `chat-ui/src/lib/operator-name.ts`
- `chat-ui/src/lib/pow-fetch.ts`
- `chat-ui/src/lib/product-format.ts`
- `chat-ui/src/lib/proof-of-work.ts`
- `chat-ui/src/lib/public-signature.ts`
- `chat-ui/src/lib/reply-errors.ts`
- `chat-ui/src/lib/request-draft-sender.ts`
- `chat-ui/src/lib/rest-url.ts`
- `chat-ui/src/lib/thread-hooks.ts`
- `chat-ui/src/lib/turn-cancel.ts`
- `chat-ui/src/lib/utils.ts`
- `chat-ui/src/lib/visitor-presence.ts`
- `chat-ui/src/lib/widget-copy.ts`
- `chat-ui/src/lib/widget-images.ts`
- `chat-ui/src/lib/widget-limits.ts`
- `chat-ui/src/lib/widget-numbers.ts`
- `chat-ui/src/main.tsx`
- `chat-ui/src/runtime.tsx`
- `chat-ui/src/sounds.ts`
- `chat-ui/src/strings.ts`
- `chat-ui/src/widget-motion.ts`

npm packages: @floating-ui/core@1.7.4, @floating-ui/dom@1.7.5, @floating-ui/react-dom@2.1.7, @floating-ui/utils@0.2.10, @radix-ui/primitive@1.1.3, @radix-ui/react-accordion@1.2.12, @radix-ui/react-arrow@1.1.7, @radix-ui/react-collapsible@1.1.12, @radix-ui/react-collection@1.1.7, @radix-ui/react-compose-refs@1.1.2, @radix-ui/react-context@1.1.2, @radix-ui/react-direction@1.1.1, @radix-ui/react-dismissable-layer@1.1.11, @radix-ui/react-dropdown-menu@2.1.16, @radix-ui/react-focus-guards@1.1.3, @radix-ui/react-focus-scope@1.1.7, @radix-ui/react-id@1.1.1, @radix-ui/react-menu@2.1.16, @radix-ui/react-popper@1.2.8, @radix-ui/react-portal@1.1.9, @radix-ui/react-presence@1.1.5, @radix-ui/react-primitive@2.1.3, @radix-ui/react-primitive@2.1.4, @radix-ui/react-roving-focus@1.1.11, @radix-ui/react-separator@1.1.8, @radix-ui/react-slot@1.2.3, @radix-ui/react-slot@1.2.4, @radix-ui/react-tooltip@1.2.8, @radix-ui/react-use-callback-ref@1.1.1, @radix-ui/react-use-controllable-state@1.2.2, @radix-ui/react-use-escape-keydown@1.1.1, @radix-ui/react-use-layout-effect@1.1.1, @radix-ui/react-use-size@1.1.1, @radix-ui/react-visually-hidden@1.2.3, @standard-community/standard-json@0.3.5, @tambo-ai/react@0.75.0, @tambo-ai/typescript-sdk@0.90.0, @tanstack/query-core@5.90.20, @tanstack/react-query@5.90.20, @ungap/structured-clone@1.3.0, aria-hidden@1.2.6, bail@2.0.2, ccount@2.0.1, class-variance-authority@0.7.1, clsx@2.1.1, comma-separated-tokens@2.0.3, d3-array@3.2.4, d3-color@3.1.0, d3-format@3.1.2, d3-interpolate@3.0.1, d3-path@3.1.0, d3-scale@4.0.2, d3-shape@3.2.0, d3-time-format@4.1.0, d3-time@3.1.0, decimal.js-light@2.5.1, decode-named-character-reference@1.3.0, devlop@1.1.0, dompurify@3.4.11, entities@6.0.1, escape-string-regexp@5.0.0, estree-util-is-identifier-name@3.0.0, eventemitter3@4.0.7, extend@3.0.2, fast-equals@5.4.0, framer-motion@12.38.0, get-nonce@1.0.1, hast-util-from-parse5@8.0.3, hast-util-parse-selector@4.0.0, hast-util-raw@9.1.0, hast-util-sanitize@5.0.2, hast-util-to-jsx-runtime@2.3.6, hast-util-to-parse5@8.0.1, hast-util-whitespace@3.0.0, hastscript@9.0.1, highlight.js@11.11.1, html-void-elements@3.0.0, inline-style-parser@0.2.7, internmap@2.0.3, is-plain-obj@4.1.0, kdbush@4.0.2, leaflet@1.9.4, lodash@4.18.1, longest-streak@3.1.0, lucide-react@0.469.0, markdown-table@3.0.4, marked@17.0.1, mdast-util-find-and-replace@3.0.2, mdast-util-from-markdown@2.0.2, mdast-util-gfm-autolink-literal@2.0.1, mdast-util-gfm-footnote@2.1.0, mdast-util-gfm-strikethrough@2.0.0, mdast-util-gfm-table@2.0.0, mdast-util-gfm-task-list-item@2.0.0, mdast-util-gfm@3.1.0, mdast-util-phrasing@4.1.0, mdast-util-to-hast@13.2.1, mdast-util-to-markdown@2.1.2, mdast-util-to-string@4.0.0, micromark-core-commonmark@2.0.3, micromark-extension-gfm-autolink-literal@2.1.0, micromark-extension-gfm-footnote@2.1.0, micromark-extension-gfm-strikethrough@2.1.0, micromark-extension-gfm-table@2.1.1, micromark-extension-gfm-task-list-item@2.1.0, micromark-extension-gfm@3.0.0, micromark-factory-destination@2.0.1, micromark-factory-label@2.0.1, micromark-factory-space@2.0.1, micromark-factory-title@2.0.1, micromark-factory-whitespace@2.0.1, micromark-util-character@2.1.1, micromark-util-chunked@2.0.1, micromark-util-classify-character@2.0.1, micromark-util-combine-extensions@2.0.1, micromark-util-decode-numeric-character-reference@2.0.2, micromark-util-decode-string@2.0.1, micromark-util-html-tag-name@2.0.1, micromark-util-normalize-identifier@2.0.1, micromark-util-resolve-all@2.0.1, micromark-util-sanitize-uri@2.0.1, micromark-util-subtokenize@2.1.0, micromark@4.0.2, motion-dom@12.38.0, motion-utils@12.36.0, parse5@7.3.0, prop-types@15.8.1, property-information@7.1.0, quansync@0.2.11, react-dom@19.2.4, react-is@18.3.1, react-remove-scroll-bar@2.3.8, react-remove-scroll@2.7.2, react-smooth@4.0.4, react-style-singleton@2.2.3, react@19.2.4, recharts-scale@0.4.5, recharts@2.15.4, rehype-harden@1.1.7, rehype-raw@7.0.0, rehype-sanitize@6.0.0, remark-gfm@4.0.1, remark-parse@11.0.0, remark-rehype@11.1.2, remend@1.1.0, scheduler@0.27.0, space-separated-tokens@2.0.2, streamdown@2.1.0, style-to-js@1.1.21, style-to-object@1.0.14, supercluster@8.0.1, tailwind-merge@3.4.0, tiny-invariant@1.3.3, trim-lines@3.0.1, trough@2.2.0, tslib@2.8.1, unified@11.0.5, unist-util-is@6.0.1, unist-util-position@5.0.0, unist-util-stringify-position@4.0.0, unist-util-visit-parents@6.0.2, unist-util-visit@5.1.0, use-callback-ref@1.3.3, use-sidecar@1.1.3, vfile-location@5.0.3, vfile-message@4.0.3, vfile@6.0.3, victory-vendor@36.9.2, web-namespaces@2.0.1, zod-to-json-schema@3.25.1, zod@4.3.6, zwitch@2.0.4.

## assets/js/chat-maps.js

Source files:

- `chat-ui/src/maps-runtime/flavors.ts`
- `chat-ui/src/maps-runtime/leaflet-ref.ts`
- `chat-ui/src/maps-runtime/main.ts`

npm packages: @mapbox/point-geometry@1.1.0, @mapbox/vector-tile@2.0.5, @protomaps/basemaps@5.7.2, color2k@2.0.4, pbf@4.0.2, pmtiles@3.2.1, potpack@1.0.2, protomaps-leaflet@5.1.0, rbush@3.0.1.

## assets/js/admin-chunks/app-BJjbRkDI.js

Source files:

- `chat-ui/src/admin/app.tsx`
- `chat-ui/src/admin/bones/content-documents.bones.json`
- `chat-ui/src/admin/bones/conversions-agenda.bones.json`
- `chat-ui/src/admin/bones/conversions-list.bones.json`
- `chat-ui/src/admin/bones/dashboard-side.bones.json`
- `chat-ui/src/admin/bones/dashboard.bones.json`
- `chat-ui/src/admin/bones/helpdesk-list.bones.json`
- `chat-ui/src/admin/bones/registry.ts`
- `chat-ui/src/admin/bones/stats.bones.json`
- `chat-ui/src/admin/bones/tools-appointments.bones.json`
- `chat-ui/src/admin/bones/tools-escalations.bones.json`
- `chat-ui/src/admin/bones/tools-leads.bones.json`
- `chat-ui/src/admin/bones/tools-products.bones.json`
- `chat-ui/src/admin/components/assistant/shared.tsx`
- `chat-ui/src/admin/components/command-palette/command-palette.tsx`
- `chat-ui/src/admin/components/conversations/inbox-format.ts`
- `chat-ui/src/admin/components/conversions/collections.ts`
- `chat-ui/src/admin/components/conversions/request-model.ts`
- `chat-ui/src/admin/components/dashboard/dashboard-page.tsx`
- `chat-ui/src/admin/components/dashboard/metrics.ts`
- `chat-ui/src/admin/components/dashboard/questions.ts`
- `chat-ui/src/admin/components/dashboard/sparkline.tsx`
- `chat-ui/src/admin/components/dashboard/text.tsx`
- `chat-ui/src/admin/components/dashboard/use-period-report.ts`
- `chat-ui/src/admin/components/layout/admin-shell.tsx`
- `chat-ui/src/admin/components/layout/background-jobs-indicator.tsx`
- `chat-ui/src/admin/components/layout/frame-context.tsx`
- `chat-ui/src/admin/components/layout/frame-events.ts`
- `chat-ui/src/admin/components/layout/notification-bell.tsx`
- `chat-ui/src/admin/components/layout/sub-nav.tsx`
- `chat-ui/src/admin/components/layout/top-bar.tsx`
- `chat-ui/src/admin/components/layout/use-inbox-count.ts`
- `chat-ui/src/admin/components/layout/user-menu.tsx`
- `chat-ui/src/admin/components/onboarding/onboarding-modal.tsx`
- `chat-ui/src/admin/components/settings/live-widget-preview.tsx`
- `chat-ui/src/admin/components/settings/widget-colors.ts`
- `chat-ui/src/admin/components/shared/admin-toaster.tsx`
- `chat-ui/src/admin/components/shared/bones.tsx`
- `chat-ui/src/admin/components/shared/kit.tsx`
- `chat-ui/src/admin/components/shared/loading-skeleton.tsx`
- `chat-ui/src/admin/components/shared/scroll-row.tsx`
- `chat-ui/src/admin/components/tutorial/tour-engine.ts`
- `chat-ui/src/admin/components/tutorial/tour-steps.ts`
- `chat-ui/src/admin/components/tutorial/tutorial-manager.tsx`
- `chat-ui/src/admin/components/tutorial/use-tour.ts`
- `chat-ui/src/admin/hooks/use-app-viewport.ts`
- `chat-ui/src/admin/hooks/use-background-jobs.tsx`
- `chat-ui/src/admin/hooks/use-conversations.ts`
- `chat-ui/src/admin/hooks/use-conversions-data.ts`
- `chat-ui/src/admin/hooks/use-dashboard.ts`
- `chat-ui/src/admin/hooks/use-notifications.ts`
- `chat-ui/src/admin/lib/chat-inbox.ts`
- `chat-ui/src/admin/lib/format.ts`
- `chat-ui/src/admin/lib/leave-guard.ts`
- `chat-ui/src/admin/lib/nav-context.tsx`
- `chat-ui/src/admin/lib/nav.ts`
- `chat-ui/src/admin/lib/notification-preferences.ts`
- `chat-ui/src/admin/lib/paging.ts`
- `chat-ui/src/admin/lib/plan-usage.ts`
- `chat-ui/src/admin/lib/poll.ts`
- `chat-ui/src/admin/lib/record-fields.ts`
- `chat-ui/src/admin/lib/site-theme.ts`
- `chat-ui/src/admin/lib/wp-nav.ts`
- `chat-ui/src/admin/main.tsx`
- `chat-ui/src/components/ai-elements/shimmer.tsx`
- `chat-ui/src/components/chat-tab-nav.tsx`
- `chat-ui/src/components/chat/ai-disclosure.tsx`
- `chat-ui/src/components/chat/attachments.tsx`
- `chat-ui/src/components/chat/header-menu.tsx`
- `chat-ui/src/components/chat/presentation.tsx`
- `chat-ui/src/components/faq-tab.tsx`
- `chat-ui/src/components/ui/button.tsx`
- `chat-ui/src/components/ui/dialog.tsx`
- `chat-ui/src/components/ui/dropdown-menu.tsx`
- `chat-ui/src/components/ui/input.tsx`
- `chat-ui/src/components/ui/popover.tsx`
- `chat-ui/src/components/ui/select.tsx`
- `chat-ui/src/components/ui/skeleton.tsx`
- `chat-ui/src/components/ui/switch.tsx`
- `chat-ui/src/components/ui/textarea.tsx`
- `chat-ui/src/lib/active-tab-color.ts`
- `chat-ui/src/lib/brand-color.ts`
- `chat-ui/src/lib/chat-attachments.ts`
- `chat-ui/src/lib/header-identity.ts`
- `chat-ui/src/lib/host-theme.ts`
- `chat-ui/src/lib/message-limit.ts`
- `chat-ui/src/lib/widget-images.ts`
- `chat-ui/src/lib/widget-limits.ts`
- `chat-ui/src/sounds.ts`
- `chat-ui/src/strings.ts`
- `chat-ui/src/widget-design.css`
- `chat-ui/src/widget-motion.ts`

npm packages: @radix-ui/number@1.1.1, @radix-ui/react-context@1.1.2, @radix-ui/react-dialog@1.1.15, @radix-ui/react-dropdown-menu@2.1.16, @radix-ui/react-menu@2.1.16, @radix-ui/react-popover@1.1.15, @radix-ui/react-presence@1.1.5, @radix-ui/react-primitive@2.1.3, @radix-ui/react-roving-focus@1.1.11, @radix-ui/react-select@2.2.6, @radix-ui/react-slot@1.2.3, @radix-ui/react-slot@1.2.4, @radix-ui/react-switch@1.2.6, @radix-ui/react-use-previous@1.1.1, @radix-ui/react-visually-hidden@1.2.3, boneyard-js@1.9.0, class-variance-authority@0.7.1, lucide-react@0.469.0, react-dom@19.2.4, scheduler@0.27.0, sonner@2.0.7.

## assets/js/admin-chunks/building-CI2BsZ1j.js

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/bundle-mjs-Wdbt-Exa.js

npm packages: clsx@2.1.1, react@19.2.4, tailwind-merge@3.4.0.

## assets/js/admin-chunks/card-D4yEucHA.js

Source files:

- `chat-ui/src/components/ui/card.tsx`


## assets/js/admin-chunks/character-page-CDyUrzv9.js

Source files:

- `chat-ui/src/admin/components/assistant/character-page.tsx`


## assets/js/admin-chunks/chart-DKqUgOK2.js

Source files:

- `chat-ui/src/components/ui/chart.tsx`

npm packages: d3-array@3.2.4, d3-color@3.1.0, d3-format@3.1.2, d3-interpolate@3.0.1, d3-path@3.1.0, d3-scale@4.0.2, d3-shape@3.2.0, d3-time-format@4.1.0, d3-time@3.1.0, decimal.js-light@2.5.1, eventemitter3@4.0.7, fast-equals@5.4.0, internmap@2.0.3, lodash@4.18.1, prop-types@15.8.1, react-is@18.3.1, react-smooth@4.0.4, recharts-scale@0.4.5, recharts@2.15.4, tiny-invariant@1.3.3, victory-vendor@36.9.2.

## assets/js/admin-chunks/circle-x-CN_XtYFn.js

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/code-block-37QAKDTI-sFEzZU-C.js

npm packages: streamdown@2.1.0.

## assets/js/admin-chunks/content-page-CV-u0v2g.js

Source files:

- `chat-ui/src/admin/components/content/business-info-section.tsx`
- `chat-ui/src/admin/components/content/content-page.tsx`
- `chat-ui/src/admin/components/content/sync-error-details.tsx`
- `chat-ui/src/admin/hooks/use-documents.ts`
- `chat-ui/src/admin/hooks/use-ingestion.ts`
- `chat-ui/src/admin/lib/timezones.ts`

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/conversations-page-BVejrVH8.js

Source files:

- `chat-ui/src/admin/components/conversations/contact-signals.ts`
- `chat-ui/src/admin/components/conversations/conversation-detail.tsx`
- `chat-ui/src/admin/components/conversations/conversation-list.tsx`
- `chat-ui/src/admin/components/conversations/conversations-page.tsx`
- `chat-ui/src/admin/components/conversations/message-bubble.tsx`
- `chat-ui/src/admin/components/conversations/visitor-context.tsx`
- `chat-ui/src/admin/components/conversations/visitor-list.tsx`
- `chat-ui/src/admin/hooks/use-agent-profile.ts`
- `chat-ui/src/admin/hooks/use-blacklist.ts`
- `chat-ui/src/admin/hooks/use-visitors.ts`
- `chat-ui/src/admin/lib/platform.ts`
- `chat-ui/src/components/ui/sheet.tsx`

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/conversions-page-CHzYhY66.js

Source files:

- `chat-ui/src/admin/components/conversions/agenda-logic.ts`
- `chat-ui/src/admin/components/conversions/agenda-page.tsx`
- `chat-ui/src/admin/components/conversions/conversions-page.tsx`
- `chat-ui/src/admin/components/conversions/request-board.tsx`
- `chat-ui/src/admin/components/conversions/request-list.tsx`
- `chat-ui/src/admin/components/conversions/request-sheet.tsx`
- `chat-ui/src/admin/components/conversions/results-state.tsx`
- `chat-ui/src/components/ui/calendar.tsx`

npm packages: @date-fns/tz@1.4.1, date-fns@4.1.0, lucide-react@0.469.0, react-day-picker@9.14.0.

## assets/js/admin-chunks/core.esm-BxuYg7dt.js

npm packages: @dnd-kit/accessibility@3.1.1, @dnd-kit/core@6.3.1, @dnd-kit/utilities@3.2.2.

## assets/js/admin-chunks/dist-Cs7gv5rv.js

Source files:

- `chat-ui/src/components/ui/surface-portal.tsx`

npm packages: @floating-ui/core@1.7.4, @floating-ui/dom@1.7.5, @floating-ui/react-dom@2.1.7, @floating-ui/utils@0.2.10, @radix-ui/react-arrow@1.1.7, @radix-ui/react-context@1.1.2, @radix-ui/react-dismissable-layer@1.1.11, @radix-ui/react-focus-guards@1.1.3, @radix-ui/react-focus-scope@1.1.7, @radix-ui/react-popper@1.2.8, @radix-ui/react-portal@1.1.9, @radix-ui/react-primitive@2.1.3, @radix-ui/react-slot@1.2.3, @radix-ui/react-use-escape-keydown@1.1.1, @radix-ui/react-use-size@1.1.1, aria-hidden@1.2.6, get-nonce@1.0.1, lucide-react@0.469.0, react-remove-scroll-bar@2.3.8, react-remove-scroll@2.7.2, react-style-singleton@2.2.3, tslib@2.8.1, use-callback-ref@1.3.3, use-sidecar@1.1.3.

## assets/js/admin-chunks/dist-hi1ENn3a.js

Source files:

- `chat-ui/src/admin/app-context.tsx`
- `chat-ui/src/admin/hooks/use-lang.ts`
- `chat-ui/src/admin/hooks/use-theme.ts`
- `chat-ui/src/admin/i18n/en.json`
- `chat-ui/src/admin/i18n/it.json`
- `chat-ui/src/admin/lib/api.ts`
- `chat-ui/src/admin/lib/config.ts`
- `chat-ui/src/admin/lib/datetime.ts`
- `chat-ui/src/admin/lib/i18n.ts`
- `chat-ui/src/admin/lib/rate-limit.ts`
- `chat-ui/src/admin/lib/support-team.ts`
- `chat-ui/src/components/icons/animated/arrow-left.tsx`
- `chat-ui/src/components/icons/animated/arrow-right.tsx`
- `chat-ui/src/components/icons/animated/arrow-up.tsx`
- `chat-ui/src/components/icons/animated/at-sign.tsx`
- `chat-ui/src/components/icons/animated/bell.tsx`
- `chat-ui/src/components/icons/animated/bot.tsx`
- `chat-ui/src/components/icons/animated/brain.tsx`
- `chat-ui/src/components/icons/animated/calendar-days.tsx`
- `chat-ui/src/components/icons/animated/chart-pie.tsx`
- `chat-ui/src/components/icons/animated/check-check.tsx`
- `chat-ui/src/components/icons/animated/check.tsx`
- `chat-ui/src/components/icons/animated/chevron-down.tsx`
- `chat-ui/src/components/icons/animated/chevron-left.tsx`
- `chat-ui/src/components/icons/animated/chevron-right.tsx`
- `chat-ui/src/components/icons/animated/chevron-up.tsx`
- `chat-ui/src/components/icons/animated/clock.tsx`
- `chat-ui/src/components/icons/animated/contrast.tsx`
- `chat-ui/src/components/icons/animated/copy.tsx`
- `chat-ui/src/components/icons/animated/credit-card.tsx`
- `chat-ui/src/components/icons/animated/download.tsx`
- `chat-ui/src/components/icons/animated/eye-off.tsx`
- `chat-ui/src/components/icons/animated/eye.tsx`
- `chat-ui/src/components/icons/animated/file-text.tsx`
- `chat-ui/src/components/icons/animated/flame.tsx`
- `chat-ui/src/components/icons/animated/folder-minus.tsx`
- `chat-ui/src/components/icons/animated/folder-open.tsx`
- `chat-ui/src/components/icons/animated/folder-plus.tsx`
- `chat-ui/src/components/icons/animated/folder-sync.tsx`
- `chat-ui/src/components/icons/animated/grip-vertical.tsx`
- `chat-ui/src/components/icons/animated/hand-metal.tsx`
- `chat-ui/src/components/icons/animated/languages.tsx`
- `chat-ui/src/components/icons/animated/layout-grid.tsx`
- `chat-ui/src/components/icons/animated/layout-panel-top.tsx`
- `chat-ui/src/components/icons/animated/linkedin.tsx`
- `chat-ui/src/components/icons/animated/lock.tsx`
- `chat-ui/src/components/icons/animated/map-pin.tsx`
- `chat-ui/src/components/icons/animated/message-circle.tsx`
- `chat-ui/src/components/icons/animated/message-square.tsx`
- `chat-ui/src/components/icons/animated/mic.tsx`
- `chat-ui/src/components/icons/animated/moon.tsx`
- `chat-ui/src/components/icons/animated/phone.tsx`
- `chat-ui/src/components/icons/animated/plus.tsx`
- `chat-ui/src/components/icons/animated/receipt-text.tsx`
- `chat-ui/src/components/icons/animated/refresh-cw.tsx`
- `chat-ui/src/components/icons/animated/rotate-ccw.tsx`
- `chat-ui/src/components/icons/animated/scan-text.tsx`
- `chat-ui/src/components/icons/animated/search.tsx`
- `chat-ui/src/components/icons/animated/send.tsx`
- `chat-ui/src/components/icons/animated/settings.tsx`
- `chat-ui/src/components/icons/animated/shield-check.tsx`
- `chat-ui/src/components/icons/animated/sparkles.tsx`
- `chat-ui/src/components/icons/animated/sun.tsx`
- `chat-ui/src/components/icons/animated/trending-down.tsx`
- `chat-ui/src/components/icons/animated/trending-up.tsx`
- `chat-ui/src/components/icons/animated/twitter.tsx`
- `chat-ui/src/components/icons/animated/upload.tsx`
- `chat-ui/src/components/icons/animated/user.tsx`
- `chat-ui/src/components/icons/animated/users.tsx`
- `chat-ui/src/components/icons/animated/wifi.tsx`
- `chat-ui/src/components/icons/animated/wrench.tsx`
- `chat-ui/src/components/icons/animated/x.tsx`
- `chat-ui/src/components/icons/animated/zap.tsx`
- `chat-ui/src/components/icons/index.ts`
- `chat-ui/src/lib/rest-url.ts`
- `chat-ui/src/lib/utils.ts`

npm packages: @radix-ui/primitive@1.1.3, @radix-ui/react-collection@1.1.7, @radix-ui/react-compose-refs@1.1.2, @radix-ui/react-context@1.1.2, @radix-ui/react-direction@1.1.1, @radix-ui/react-id@1.1.1, @radix-ui/react-slot@1.2.3, @radix-ui/react-use-callback-ref@1.1.1, @radix-ui/react-use-controllable-state@1.2.2, @radix-ui/react-use-layout-effect@1.1.1, framer-motion@12.38.0, lucide-react@0.469.0, motion-dom@12.38.0, motion-utils@12.36.0, react-dom@19.2.4.

## assets/js/admin-chunks/exports-BbVf70K9.js

Source files:

- `chat-ui/src/admin/components/conversions/exports.ts`
- `chat-ui/src/admin/components/conversions/parts.tsx`


## assets/js/admin-chunks/globe-DACEBuE1.js

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/headset-dKvucaXj.js

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/helpdesk-page-CiRtx4y2.js

Source files:

- `chat-ui/src/admin/components/helpdesk/faq-errors.ts`
- `chat-ui/src/admin/components/helpdesk/helpdesk-page.tsx`
- `chat-ui/src/admin/hooks/use-helpdesk-categories.ts`
- `chat-ui/src/admin/hooks/use-helpdesk.ts`

npm packages: @dnd-kit/sortable@10.0.0.

## assets/js/admin-chunks/inline-select-BwLBKCpW.js

Source files:

- `chat-ui/src/admin/components/shared/inline-select.tsx`


## assets/js/admin-chunks/label-C8-4UMvQ.js

Source files:

- `chat-ui/src/components/ui/label.tsx`

npm packages: @radix-ui/react-label@2.1.8, @radix-ui/react-primitive@2.1.4.

## assets/js/admin-chunks/markdown-components-DHORbGeR.js

Source files:

- `chat-ui/src/components/safe-markdown.tsx`
- `chat-ui/src/components/tambo/markdown-components.tsx`
- `chat-ui/src/components/tool-ui/shared/media/sanitize-href.ts`
- `chat-ui/src/lib/widget-copy.ts`

npm packages: @ungap/structured-clone@1.3.0, bail@2.0.2, ccount@2.0.1, comma-separated-tokens@2.0.3, decode-named-character-reference@1.3.0, devlop@1.1.0, entities@6.0.1, escape-string-regexp@5.0.0, estree-util-is-identifier-name@3.0.0, extend@3.0.2, hast-util-from-parse5@8.0.3, hast-util-parse-selector@4.0.0, hast-util-raw@9.1.0, hast-util-sanitize@5.0.2, hast-util-to-jsx-runtime@2.3.6, hast-util-to-parse5@8.0.1, hast-util-whitespace@3.0.0, hastscript@9.0.1, highlight.js@11.11.1, html-void-elements@3.0.0, inline-style-parser@0.2.7, is-plain-obj@4.1.0, longest-streak@3.1.0, markdown-table@3.0.4, marked@17.0.1, mdast-util-find-and-replace@3.0.2, mdast-util-from-markdown@2.0.2, mdast-util-gfm-autolink-literal@2.0.1, mdast-util-gfm-footnote@2.1.0, mdast-util-gfm-strikethrough@2.0.0, mdast-util-gfm-table@2.0.0, mdast-util-gfm-task-list-item@2.0.0, mdast-util-gfm@3.1.0, mdast-util-phrasing@4.1.0, mdast-util-to-hast@13.2.1, mdast-util-to-markdown@2.1.2, mdast-util-to-string@4.0.0, micromark-core-commonmark@2.0.3, micromark-extension-gfm-autolink-literal@2.1.0, micromark-extension-gfm-footnote@2.1.0, micromark-extension-gfm-strikethrough@2.1.0, micromark-extension-gfm-table@2.1.1, micromark-extension-gfm-task-list-item@2.1.0, micromark-extension-gfm@3.0.0, micromark-factory-destination@2.0.1, micromark-factory-label@2.0.1, micromark-factory-space@2.0.1, micromark-factory-title@2.0.1, micromark-factory-whitespace@2.0.1, micromark-util-character@2.1.1, micromark-util-chunked@2.0.1, micromark-util-classify-character@2.0.1, micromark-util-combine-extensions@2.0.1, micromark-util-decode-numeric-character-reference@2.0.2, micromark-util-decode-string@2.0.1, micromark-util-html-tag-name@2.0.1, micromark-util-normalize-identifier@2.0.1, micromark-util-resolve-all@2.0.1, micromark-util-sanitize-uri@2.0.1, micromark-util-subtokenize@2.1.0, micromark@4.0.2, parse5@7.3.0, property-information@7.1.0, rehype-harden@1.1.7, rehype-raw@7.0.0, rehype-sanitize@6.0.0, remark-gfm@4.0.1, remark-parse@11.0.0, remark-rehype@11.1.2, remend@1.1.0, space-separated-tokens@2.0.2, streamdown@2.1.0, style-to-js@1.1.21, style-to-object@1.0.14, trim-lines@3.0.1, trough@2.2.0, unified@11.0.5, unist-util-is@6.0.1, unist-util-position@5.0.0, unist-util-stringify-position@4.0.0, unist-util-visit-parents@6.0.2, unist-util-visit@5.1.0, vfile-location@5.0.3, vfile-message@4.0.3, vfile@6.0.3, web-namespaces@2.0.1, zwitch@2.0.4.

## assets/js/admin-chunks/mermaid-4DMBBIKO-C9YSrna_.js

No code of its own: it only passes on what another script of this folder exports.

## assets/js/admin-chunks/pencil-CHezSetv.js

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/plus-Cb0iPZE5.js

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/prova-page-BwLSPJtm.js

Source files:

- `chat-ui/src/admin/components/assistant/prova-client.ts`
- `chat-ui/src/admin/components/assistant/prova-components.tsx`
- `chat-ui/src/admin/components/assistant/prova-page.tsx`
- `chat-ui/src/components/chat/tool-slot.tsx`
- `chat-ui/src/components/generative-ui/card-carousel.tsx`
- `chat-ui/src/components/generative-ui/table-card.tsx`
- `chat-ui/src/components/tool-ui/chart/chart.tsx`
- `chat-ui/src/components/tool-ui/stats-display/sparkline.tsx`
- `chat-ui/src/components/tool-ui/stats-display/stats-display.tsx`
- `chat-ui/src/lib/card-copy.ts`
- `chat-ui/src/lib/pow-fetch.ts`
- `chat-ui/src/lib/product-format.ts`
- `chat-ui/src/lib/proof-of-work.ts`
- `chat-ui/src/lib/turn-cancel.ts`
- `chat-ui/src/widget-cards.css`

npm packages: recharts@2.15.4.

## assets/js/admin-chunks/purify.es-yeT1JqXB.js

npm packages: dompurify@3.4.11.

## assets/js/admin-chunks/settings-page-DQrgstIl.js

Source files:

- `chat-ui/src/admin/components/integrations/woocommerce-setup.tsx`
- `chat-ui/src/admin/components/settings/advanced-section.tsx`
- `chat-ui/src/admin/components/settings/avatar-picker.tsx`
- `chat-ui/src/admin/components/settings/brand-color-choices.tsx`
- `chat-ui/src/admin/components/settings/chat-customizer.tsx`
- `chat-ui/src/admin/components/settings/contact-social-section.tsx`
- `chat-ui/src/admin/components/settings/gdpr-settings-section.tsx`
- `chat-ui/src/admin/components/settings/image-field.tsx`
- `chat-ui/src/admin/components/settings/legacy-access-section.tsx`
- `chat-ui/src/admin/components/settings/notifications-section.tsx`
- `chat-ui/src/admin/components/settings/preview-focus.ts`
- `chat-ui/src/admin/components/settings/settings-page.tsx`
- `chat-ui/src/admin/components/settings/support-team-section.tsx`
- `chat-ui/src/admin/components/settings/team-section.tsx`
- `chat-ui/src/admin/components/settings/widget-editor-rows.tsx`
- `chat-ui/src/admin/components/settings/widget-experience-controls.tsx`
- `chat-ui/src/admin/components/settings/widget-number-field.tsx`
- `chat-ui/src/admin/components/settings/widget-visibility-controls.tsx`
- `chat-ui/src/admin/components/settings/woocommerce-row.tsx`
- `chat-ui/src/admin/components/shared/collapsible-section.tsx`
- `chat-ui/src/admin/components/shared/color-picker.tsx`
- `chat-ui/src/admin/components/shared/help-tooltip.tsx`
- `chat-ui/src/admin/hooks/use-checked-field.ts`
- `chat-ui/src/admin/lib/color.ts`
- `chat-ui/src/admin/lib/wp-media.ts`
- `chat-ui/src/components/ui/collapsible.tsx`
- `chat-ui/src/lib/widget-numbers.ts`

npm packages: @radix-ui/react-collapsible@1.1.12, @radix-ui/react-context@1.1.2, @radix-ui/react-primitive@2.1.3, @radix-ui/react-slot@1.2.3, lucide-react@0.469.0.

## assets/js/admin-chunks/stats-page-Dv5I1SMw.js

Source files:

- `chat-ui/src/admin/components/dashboard/conversation-types-chart.tsx`
- `chat-ui/src/admin/components/dashboard/daily-conversations-chart.tsx`
- `chat-ui/src/admin/components/dashboard/indexed-content-chart.tsx`
- `chat-ui/src/admin/components/dashboard/ingestion-bar-chart.tsx`
- `chat-ui/src/admin/components/dashboard/kpi-cards.tsx`
- `chat-ui/src/admin/components/dashboard/metric-chart.tsx`
- `chat-ui/src/admin/components/dashboard/recent-conversations.tsx`
- `chat-ui/src/admin/components/dashboard/share-report-card.tsx`
- `chat-ui/src/admin/components/dashboard/stats-data.tsx`
- `chat-ui/src/admin/components/dashboard/stats-page.tsx`
- `chat-ui/src/admin/components/dashboard/tool-usage-widget.tsx`
- `chat-ui/src/admin/components/dashboard/trend-chart.tsx`
- `chat-ui/src/admin/components/dashboard/usage-donut.tsx`
- `chat-ui/src/admin/hooks/use-report-share.ts`
- `chat-ui/src/admin/lib/tool-labels.ts`

npm packages: lodash@4.18.1, recharts@2.15.4.

## assets/js/admin-chunks/support-chat-popup-ISWmAZQY.js

Source files:

- `chat-ui/src/admin/components/support/support-chat-popup.tsx`
- `chat-ui/src/admin/components/support/support-chat.tsx`
- `chat-ui/src/admin/components/support/support-panel.tsx`
- `chat-ui/src/admin/hooks/use-support-chat.ts`
- `chat-ui/src/hooks/use-mobile.tsx`

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/tabs-DErgNU3P.js

Source files:

- `chat-ui/src/components/ui/tabs.tsx`

npm packages: @radix-ui/react-context@1.1.2, @radix-ui/react-primitive@2.1.3, @radix-ui/react-slot@1.2.3, @radix-ui/react-tabs@1.1.13.

## assets/js/admin-chunks/tool-settings-section-ClLqo4Mo.js

Source files:

- `chat-ui/src/admin/components/integrations/google-calendar-setup.tsx`
- `chat-ui/src/admin/components/settings/ai-persona-section.tsx`
- `chat-ui/src/admin/components/settings/google-calendar-appointment-card.tsx`
- `chat-ui/src/admin/components/settings/tool-settings-section.tsx`

npm packages: lucide-react@0.469.0.

## assets/js/admin-chunks/tools-page-Bj7rudIB.js

Source files:

- `chat-ui/src/admin/components/tools/data-table.tsx`
- `chat-ui/src/admin/components/tools/tools-page.tsx`
- `chat-ui/src/admin/hooks/use-tools.ts`
- `chat-ui/src/components/ui/badge.tsx`
- `chat-ui/src/components/ui/table.tsx`


## assets/js/admin-chunks/unanswered-questions-BZkUZVnJ.js

Source files:

- `chat-ui/src/admin/components/assistant/unanswered-questions.tsx`
- `chat-ui/src/admin/components/assistant/use-knowledge-gaps.ts`


## assets/js/admin-chunks/upgrade-page-B75i4KVS.js

Source files:

- `chat-ui/src/admin/components/upgrade/pricing-copy.ts`
- `chat-ui/src/admin/components/upgrade/upgrade-page.tsx`


## assets/js/admin-chunks/use-google-calendar-connect-D-U6xWSx.js

Source files:

- `chat-ui/src/admin/components/integrations/use-google-calendar-connect.ts`


## assets/js/admin-chunks/use-settings-DTw08moK.js

Source files:

- `chat-ui/src/admin/hooks/use-settings.ts`

npm packages: use-debounce@10.1.0.

## assets/js/admin-chunks/use-support-profiles-DtPpkNlq.js

Source files:

- `chat-ui/src/admin/hooks/use-support-profiles.ts`


## assets/js/admin-chunks/validate-OfFSIc0y.js

Source files:

- `chat-ui/src/admin/lib/validate.ts`

