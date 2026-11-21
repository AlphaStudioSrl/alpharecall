=== AlphaRecall ===
Contributors: alphastudio
Tags: chatbot, ai assistant, live chat, woocommerce, customer support
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.1.95
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Site assistant that answers from your content, takes requests and bookings, and knows your WooCommerce store. Train it from wp-admin.

== Description ==

AlphaRecall adds an assistant to your website that answers visitors from the pages, posts, products and documents you choose. What sets it apart from a chat box that only writes text: it works with your WooCommerce store and your calendar, it answers with interactive cards, and you train it and handle conversations from wp-admin. Some of these features depend on the plan; see "What each plan includes" below.

= It works with your store and your calendar =

* **WooCommerce**: tells a customer the status of their order (order number plus the billing e-mail of that order), checks whether a coupon code is valid, builds a cart link for a product and shows products with their price in the store currency.
* **Google Calendar**: appointments booked in the chat are written to your Google Calendar, and only free slots are offered.

Both are off until you turn them on in the dashboard. WooCommerce only runs while WooCommerce is active.

= Answers as cards =

Besides text, the assistant answers with cards the visitor can use: products, booking, contact and quote forms (nothing is sent until the visitor confirms), tables, charts and maps. Maps are drawn from a self-hosted OpenStreetMap archive (Protomaps format) on the AlphaRecall map server; no Google Maps tiles are loaded.

= Training and team inbox in wp-admin =

* Questions the assistant could not answer are listed in **Training**. With FAQs (Performance plan and up), one click opens a new FAQ with the question filled in, and saving the answer marks the question resolved.
* **Prova** (Test) lets you ask what a visitor would ask and shows, beside each answer, the pages and FAQs the assistant used to write it.
* In **Messages** a person on your team can take over a chat and reply; the assistant pauses while they do.

The dashboard has seven sections:

* **Today**: what happened on the site, the requests that need an answer and how the assistant is doing.
* **Messages**: every conversation, with the option to take over a chat and reply yourself.
* **Requests**: contact, quote, callback and appointment requests collected by the assistant, with their status.
* **Statistics**: conversations, answered questions, handoffs and the questions the assistant could not answer yet.
* **Training**: choose which content the assistant learns from, add documents and FAQs, test the assistant.
* **Customization**: colors, position, avatar, welcome message and suggested questions of the chat widget, with a live preview.
* **Settings**: team access, notifications, privacy and your plan.

The chat widget is a lightweight script, loads its own fonts locally and follows the visitor's light or dark preference.

= An AlphaRecall account is required =

The assistant runs on the AlphaRecall cloud service. After you activate the plugin, an administrator connects the site from the AlphaRecall menu; nothing is sent to the service before that. New accounts start with a 15-day free trial that includes a limited number of messages. When the trial ends or its messages are used up, the service stops answering and the chat widget is hidden until you choose a paid plan; paid plans add more messages and features. See [alpharecall.com](https://alpharecall.com/) for plans and pricing.

= What each plan includes =

The AlphaRecall service applies the plan. The plugin's own settings (colors, avatar, texts and the credit link) are the same on every plan.

* **Trial**: answers from your content, with tables and charts.
* **Base**: contact, callback and booking forms, product cards, your address on a map, newsletter sign-ups and WooCommerce product answers.
* **Performance**: quote requests, WooCommerce order status, coupon checks and cart links, events, and FAQs, including the one-click FAQ from an unanswered question.
* **Business**: the support team role, for people who are not administrators.

= Languages =

The dashboard is available in Italian and English, the texts of the chat widget can be edited from the dashboard, and the assistant answers visitors in the language they write in.

== External services ==

AlphaRecall is a hosted service: the assistant, the conversations and the dashboard data live on the AlphaRecall API, and the plugin is its WordPress client. This section lists every service the plugin, the dashboard or the chat widget can contact, what is sent, and when.

The plugin contacts none of them before a site administrator ticks "I agree" and clicks **Connect** on the AlphaRecall connection screen. Until then no request leaves the site and the widget is not shown.

Your site's PHP only ever calls the AlphaRecall API, and the plugin loads no script from a third party.

= AlphaRecall API (api.alpharecall.com) =

The service that runs the assistant, stores conversations and requests, and powers the dashboard. Operated by AlphaRecall.

* When you connect: the site address is sent to create your account. AlphaRecall then calls back a public endpoint of your site (`/wp-json/alpharecall/v1/enroll/verify`) once, to confirm the request really comes from your site. Once connected, the site name is sent too, to label your dashboard and reports.
* While training: the pages, posts, products and documents you select are sent so the assistant can answer from them, and again when they change.
* When a visitor chats: the messages, the files they attach, the contact details they choose to leave, their IP address (used for rate limiting and abuse protection) and the page they are on are sent to generate the answer and store the conversation.
* WooCommerce (off until you turn it on under Settings > Advanced): products and order events (order number, status, totals, product IDs and dates, no customer details). When a visitor asks about an order, the service sends your site the order number and the e-mail the visitor gave; only when that e-mail matches the order's billing e-mail does your site answer, with the order number, status, date, items (name, quantity, price, image) and totals with currency. A coupon check sends the code and gets back whether it is valid, its discount, expiry and usage limits; a cart link request gets the product name and an add-to-cart link.
* Logged-in WordPress users (optional, off by default): if you turn on "Recognize WordPress users" in Settings > Privacy, the widget registers a logged-in user as a visitor as soon as the chat loads, sending their display name, e-mail address, WordPress user ID and avatar URL.
* In the dashboard: the settings you change and the requests you handle. Each dashboard request carries the WordPress user ID, e-mail address and role of the administrator or support team member making it, so the service applies their permissions and records who did what. When a team member replies in a chat, their name is sent and shown to the visitor with the reply.

Terms of Service: https://alpharecall.com/terms-and-conditions/
Privacy Policy: https://alpharecall.com/privacy-policy/

= AlphaRecall map tiles (api.alpharecall.com/maps) =

When the assistant shows a location on a map in the chat, the visitor's browser loads map tiles from the AlphaRecall map server. The request contains the visitor's IP address and the map area shown. Same Terms of Service and Privacy Policy as above. Map data © OpenStreetMap contributors.

= Polar (polar.sh), payments =

If you upgrade your plan, you are sent to a checkout page hosted by Polar, our payment provider. The plugin itself handles no card data.
Terms: https://polar.sh/legal/terms
Privacy: https://polar.sh/legal/privacy

= Gravatar (avatars) =

WordPress shows profile pictures through Gravatar, a service of Automattic. The plugin uses the WordPress function `get_avatar_url()` for the administrators and team members who answer chats, and for logged-in visitors when "Recognize WordPress users" is on. The resulting image address (which contains a hash of the person's e-mail address) is sent to the AlphaRecall API with the profile, and the browser of whoever sees that picture in the dashboard or in the chat loads it from Gravatar, which receives that browser's IP address. If your site replaces Gravatar with local avatars, those are used.
Terms: https://automattic.com/tos/
Privacy: https://automattic.com/privacy/

= Google Maps (links only) =

The plugin loads nothing from Google Maps. A location card in the chat has a "Directions" link, and the business details card links to the map address you entered (or, if you entered none, to a Google Maps search for your business address). Google receives a request only when a visitor clicks such a link, and it contains your business address or coordinates, never data about the visitor beyond what any link click sends.
Google Terms: https://policies.google.com/terms
Google Privacy Policy: https://policies.google.com/privacy

= Your own map tile server (optional, developers) =

A developer can point the widget's maps at a tile server of their choice with the `ALPHARECALL_MAP_OSM_SELFHOST_URL` constant. The visitor's browser then loads map tiles from that address, which you choose and operate. Nothing is set by default.

= Google Calendar (optional) =

Off until you connect it under Training > Personality and tools. You sign in on Google's own page; your site never calls Google. From then on the AlphaRecall service reads your free and busy times and your calendar list, and creates, moves and cancels the events of the appointments visitors book (with the name and contact details the visitor gave). Disconnecting stops it.
Google Terms: https://policies.google.com/terms
Google Privacy Policy: https://policies.google.com/privacy

= Your own webhook address (optional) =

Under Settings > Advanced you can enter an address of your own. When a conversation is handed to your team, the AlphaRecall service sends the request (the details the visitor left and a reference to the conversation) to that address. You choose and operate the receiver. Nothing is set by default.

= Addresses in the code that are never contacted =

Some web addresses appear in the plugin's files without the plugin ever requesting them:

* Map licence notice: the maps in the chat show "© OpenStreetMap" and "Protomaps" with links to openstreetmap.org and protomaps.com. This is the attribution the map data licence (ODbL) requires, shown only on a map, and nothing is requested until someone clicks it.
* Examples in form fields: youtube.com, x.com, tiktok.com, linkedin.com, instagram.com, facebook.com, maps.google.com, example.com, esempio.com, tuosito.it and yoursite.com are placeholder text in the fields where you type your own addresses.
* Bundled open source libraries: react.dev, github.com, radix-ui.com, leafletjs.com, fb.me and docs.expo.dev occur in the error messages and comments of the libraries the dashboard and the widget are built from; w3.org, json-schema.org and ibm.com are XML and JSON schema identifiers.

== Source code ==

The JavaScript and CSS files in `assets/js/` and `assets/css/` are compiled and minified. Their complete human-readable source code (React and TypeScript) is included in this plugin, in the `chat-ui/` folder:

* `assets/js/chat.js` and `assets/css/chat.css` (the chat widget) are built from `chat-ui/src/main.tsx` and the files it imports.
* `assets/js/chat-maps.js` (the map shown in the chat) is built from `chat-ui/src/maps-runtime/`.
* `assets/js/admin.js`, every file in `assets/js/admin-chunks/` and `assets/css/admin.css` (the dashboard) are built from `chat-ui/src/admin/main.tsx` and the files it imports.

To rebuild them, with Node.js 20 or newer:

`cd chat-ui`
`npm ci`
`npm run build`
`npm run build:admin`

`npm run build` writes the widget files and `npm run build:admin` the dashboard files, with Vite. The build settings are the `vite.*.config.ts` and `tailwind.*.ts` files in `chat-ui/`. `chat-ui/BUILD.md` repeats these steps.

The same source code is also public at https://github.com/AlphaStudioSrl/alpharecall, where each plugin version is tagged.

For every single file in `assets/js/`, `chat-ui/BUNDLE-SOURCES.md` lists the source files of `chat-ui/src/` and the libraries it is compiled from. The libraries are not copied into the plugin as source: `npm ci` downloads them, and the "Third-party libraries" section below links the public source repository of each one.

== Third-party libraries ==

The compiled scripts include open source libraries, all under GPL-compatible licences: mostly MIT or ISC, Leaflet BSD-2-Clause, Protomaps, PMTiles and highlight.js BSD-3-Clause, DOMPurify MPL-2.0 or Apache-2.0, the Tambo SDK and Streamdown Apache-2.0. Their code is not modified: `npm ci` downloads the exact versions listed in `chat-ui/package-lock.json` and the build compiles them into the scripts. `chat-ui/BUNDLE-SOURCES.md` says which libraries are inside each script, and `chat-ui/THIRD-PARTY-LICENSES.md` carries their licence texts.

The Geist font files in `assets/assets/` (SIL Open Font License 1.1) come from @fontsource-variable/geist 5.3.0: https://github.com/fontsource/font-files (the typeface itself: https://github.com/vercel/geist-font).

The libraries compiled into the scripts, each with the public repository of its source code:

* @date-fns/tz 1.4.1: https://github.com/date-fns/tz
* @dnd-kit/accessibility 3.1.1, @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/utilities 3.2.2: https://github.com/clauderic/dnd-kit
* @floating-ui/core 1.7.4, @floating-ui/dom 1.7.5, @floating-ui/react-dom 2.1.7, @floating-ui/utils 0.2.10: https://github.com/floating-ui/floating-ui
* @mapbox/point-geometry 1.1.0: https://github.com/mapbox/point-geometry
* @mapbox/vector-tile 2.0.5: https://github.com/mapbox/vector-tile-js
* @protomaps/basemaps 5.7.2: https://github.com/protomaps/basemaps
* @radix-ui/number 1.1.1, @radix-ui/primitive 1.1.3, @radix-ui/react-accordion 1.2.12, @radix-ui/react-arrow 1.1.7, @radix-ui/react-collapsible 1.1.12, @radix-ui/react-collection 1.1.7, @radix-ui/react-compose-refs 1.1.2, @radix-ui/react-context 1.1.2, @radix-ui/react-dialog 1.1.15, @radix-ui/react-direction 1.1.1, @radix-ui/react-dismissable-layer 1.1.11, @radix-ui/react-dropdown-menu 2.1.16, @radix-ui/react-focus-guards 1.1.3, @radix-ui/react-focus-scope 1.1.7, @radix-ui/react-id 1.1.1, @radix-ui/react-label 2.1.8, @radix-ui/react-menu 2.1.16, @radix-ui/react-popover 1.1.15, @radix-ui/react-popper 1.2.8, @radix-ui/react-portal 1.1.9, @radix-ui/react-presence 1.1.5, @radix-ui/react-primitive 2.1.3, @radix-ui/react-primitive 2.1.4, @radix-ui/react-roving-focus 1.1.11, @radix-ui/react-select 2.2.6, @radix-ui/react-separator 1.1.8, @radix-ui/react-slot 1.2.3, @radix-ui/react-slot 1.2.4, @radix-ui/react-switch 1.2.6, @radix-ui/react-tabs 1.1.13, @radix-ui/react-tooltip 1.2.8, @radix-ui/react-use-callback-ref 1.1.1, @radix-ui/react-use-controllable-state 1.2.2, @radix-ui/react-use-escape-keydown 1.1.1, @radix-ui/react-use-layout-effect 1.1.1, @radix-ui/react-use-previous 1.1.1, @radix-ui/react-use-size 1.1.1, @radix-ui/react-visually-hidden 1.2.3: https://github.com/radix-ui/primitives
* @standard-community/standard-json 0.3.5: https://github.com/standard-community/standard-json
* @tambo-ai/react 0.75.0: https://github.com/tambo-ai/tambo
* @tambo-ai/typescript-sdk 0.90.0: https://github.com/tambo-ai/typescript-sdk
* @tanstack/query-core 5.90.20, @tanstack/react-query 5.90.20: https://github.com/TanStack/query
* @ungap/structured-clone 1.3.0: https://github.com/ungap/structured-clone
* aria-hidden 1.2.6: https://github.com/theKashey/aria-hidden
* bail 2.0.2: https://github.com/wooorm/bail
* boneyard-js 1.9.0: https://github.com/0xGF/boneyard
* ccount 2.0.1: https://github.com/wooorm/ccount
* class-variance-authority 0.7.1: https://github.com/joe-bell/cva
* clsx 2.1.1: https://github.com/lukeed/clsx
* color2k 2.0.4: https://github.com/ricokahler/color2k
* comma-separated-tokens 2.0.3: https://github.com/wooorm/comma-separated-tokens
* d3-array 3.2.4: https://github.com/d3/d3-array
* d3-color 3.1.0: https://github.com/d3/d3-color
* d3-format 3.1.2: https://github.com/d3/d3-format
* d3-interpolate 3.0.1: https://github.com/d3/d3-interpolate
* d3-path 3.1.0: https://github.com/d3/d3-path
* d3-scale 4.0.2: https://github.com/d3/d3-scale
* d3-shape 3.2.0: https://github.com/d3/d3-shape
* d3-time 3.1.0: https://github.com/d3/d3-time
* d3-time-format 4.1.0: https://github.com/d3/d3-time-format
* date-fns 4.1.0: https://github.com/date-fns/date-fns
* decimal.js-light 2.5.1: https://github.com/MikeMcl/decimal.js-light
* decode-named-character-reference 1.3.0: https://github.com/wooorm/decode-named-character-reference
* devlop 1.1.0: https://github.com/wooorm/devlop
* dompurify 3.4.11: https://github.com/cure53/DOMPurify
* entities 6.0.1: https://github.com/fb55/entities
* escape-string-regexp 5.0.0: https://github.com/sindresorhus/escape-string-regexp
* estree-util-is-identifier-name 3.0.0: https://github.com/syntax-tree/estree-util-is-identifier-name
* eventemitter3 4.0.7: https://github.com/primus/eventemitter3
* extend 3.0.2: https://github.com/justmoon/node-extend
* fast-equals 5.4.0: https://github.com/planttheidea/fast-equals
* framer-motion 12.38.0, motion-dom 12.38.0, motion-utils 12.36.0: https://github.com/motiondivision/motion
* get-nonce 1.0.1: https://github.com/theKashey/get-nonce
* hast-util-from-parse5 8.0.3: https://github.com/syntax-tree/hast-util-from-parse5
* hast-util-parse-selector 4.0.0: https://github.com/syntax-tree/hast-util-parse-selector
* hast-util-raw 9.1.0: https://github.com/syntax-tree/hast-util-raw
* hast-util-sanitize 5.0.2: https://github.com/syntax-tree/hast-util-sanitize
* hast-util-to-jsx-runtime 2.3.6: https://github.com/syntax-tree/hast-util-to-jsx-runtime
* hast-util-to-parse5 8.0.1: https://github.com/syntax-tree/hast-util-to-parse5
* hast-util-whitespace 3.0.0: https://github.com/syntax-tree/hast-util-whitespace
* hastscript 9.0.1: https://github.com/syntax-tree/hastscript
* highlight.js 11.11.1: https://github.com/highlightjs/highlight.js
* html-void-elements 3.0.0: https://github.com/wooorm/html-void-elements
* inline-style-parser 0.2.7: https://github.com/remarkablemark/inline-style-parser
* internmap 2.0.3: https://github.com/mbostock/internmap
* is-plain-obj 4.1.0: https://github.com/sindresorhus/is-plain-obj
* kdbush 4.0.2: https://github.com/mourner/kdbush
* leaflet 1.9.4: https://github.com/Leaflet/Leaflet
* lodash 4.18.1: https://github.com/lodash/lodash
* longest-streak 3.1.0: https://github.com/wooorm/longest-streak
* lucide-react 0.469.0: https://github.com/lucide-icons/lucide
* markdown-table 3.0.4: https://github.com/wooorm/markdown-table
* marked 17.0.1: https://github.com/markedjs/marked
* mdast-util-find-and-replace 3.0.2: https://github.com/syntax-tree/mdast-util-find-and-replace
* mdast-util-from-markdown 2.0.2: https://github.com/syntax-tree/mdast-util-from-markdown
* mdast-util-gfm 3.1.0: https://github.com/syntax-tree/mdast-util-gfm
* mdast-util-gfm-autolink-literal 2.0.1: https://github.com/syntax-tree/mdast-util-gfm-autolink-literal
* mdast-util-gfm-footnote 2.1.0: https://github.com/syntax-tree/mdast-util-gfm-footnote
* mdast-util-gfm-strikethrough 2.0.0: https://github.com/syntax-tree/mdast-util-gfm-strikethrough
* mdast-util-gfm-table 2.0.0: https://github.com/syntax-tree/mdast-util-gfm-table
* mdast-util-gfm-task-list-item 2.0.0: https://github.com/syntax-tree/mdast-util-gfm-task-list-item
* mdast-util-phrasing 4.1.0: https://github.com/syntax-tree/mdast-util-phrasing
* mdast-util-to-hast 13.2.1: https://github.com/syntax-tree/mdast-util-to-hast
* mdast-util-to-markdown 2.1.2: https://github.com/syntax-tree/mdast-util-to-markdown
* mdast-util-to-string 4.0.0: https://github.com/syntax-tree/mdast-util-to-string
* micromark 4.0.2, micromark-core-commonmark 2.0.3, micromark-factory-destination 2.0.1, micromark-factory-label 2.0.1, micromark-factory-space 2.0.1, micromark-factory-title 2.0.1, micromark-factory-whitespace 2.0.1, micromark-util-character 2.1.1, micromark-util-chunked 2.0.1, micromark-util-classify-character 2.0.1, micromark-util-combine-extensions 2.0.1, micromark-util-decode-numeric-character-reference 2.0.2, micromark-util-decode-string 2.0.1, micromark-util-html-tag-name 2.0.1, micromark-util-normalize-identifier 2.0.1, micromark-util-resolve-all 2.0.1, micromark-util-sanitize-uri 2.0.1, micromark-util-subtokenize 2.1.0: https://github.com/micromark/micromark
* micromark-extension-gfm 3.0.0: https://github.com/micromark/micromark-extension-gfm
* micromark-extension-gfm-autolink-literal 2.1.0: https://github.com/micromark/micromark-extension-gfm-autolink-literal
* micromark-extension-gfm-footnote 2.1.0: https://github.com/micromark/micromark-extension-gfm-footnote
* micromark-extension-gfm-strikethrough 2.1.0: https://github.com/micromark/micromark-extension-gfm-strikethrough
* micromark-extension-gfm-table 2.1.1: https://github.com/micromark/micromark-extension-gfm-table
* micromark-extension-gfm-task-list-item 2.1.0: https://github.com/micromark/micromark-extension-gfm-task-list-item
* parse5 7.3.0: https://github.com/inikulin/parse5
* pbf 4.0.2: https://github.com/mapbox/pbf
* pmtiles 3.2.1: https://github.com/protomaps/pmtiles
* potpack 1.0.2: https://github.com/mapbox/potpack
* prop-types 15.8.1: https://github.com/facebook/prop-types
* property-information 7.1.0: https://github.com/wooorm/property-information
* protomaps-leaflet 5.1.0: https://github.com/protomaps/protomaps-leaflet
* quansync 0.2.11: https://github.com/quansync-dev/quansync
* rbush 3.0.1: https://github.com/mourner/rbush
* react 19.2.4, react-dom 19.2.4, react-is 18.3.1, scheduler 0.27.0: https://github.com/facebook/react
* react-day-picker 9.14.0: https://github.com/gpbl/react-day-picker
* react-remove-scroll 2.7.2: https://github.com/theKashey/react-remove-scroll
* react-remove-scroll-bar 2.3.8: https://github.com/theKashey/react-remove-scroll-bar
* react-smooth 4.0.4: https://github.com/recharts/react-smooth
* react-style-singleton 2.2.3: https://github.com/theKashey/react-style-singleton
* recharts 2.15.4: https://github.com/recharts/recharts
* recharts-scale 0.4.5: https://github.com/recharts/recharts-scale
* rehype-harden 1.1.7: https://github.com/vercel-labs/markdown-sanitizers
* rehype-raw 7.0.0: https://github.com/rehypejs/rehype-raw
* rehype-sanitize 6.0.0: https://github.com/rehypejs/rehype-sanitize
* remark-gfm 4.0.1: https://github.com/remarkjs/remark-gfm
* remark-parse 11.0.0: https://github.com/remarkjs/remark
* remark-rehype 11.1.2: https://github.com/remarkjs/remark-rehype
* remend 1.1.0, streamdown 2.1.0: https://github.com/vercel/streamdown
* sonner 2.0.7: https://github.com/emilkowalski/sonner
* space-separated-tokens 2.0.2: https://github.com/wooorm/space-separated-tokens
* style-to-js 1.1.21: https://github.com/remarkablemark/style-to-js
* style-to-object 1.0.14: https://github.com/remarkablemark/style-to-object
* supercluster 8.0.1: https://github.com/mapbox/supercluster
* tailwind-merge 3.4.0: https://github.com/dcastil/tailwind-merge
* tiny-invariant 1.3.3: https://github.com/alexreardon/tiny-invariant
* trim-lines 3.0.1: https://github.com/wooorm/trim-lines
* trough 2.2.0: https://github.com/wooorm/trough
* tslib 2.8.1: https://github.com/Microsoft/tslib
* unified 11.0.5: https://github.com/unifiedjs/unified
* unist-util-is 6.0.1: https://github.com/syntax-tree/unist-util-is
* unist-util-position 5.0.0: https://github.com/syntax-tree/unist-util-position
* unist-util-stringify-position 4.0.0: https://github.com/syntax-tree/unist-util-stringify-position
* unist-util-visit 5.1.0: https://github.com/syntax-tree/unist-util-visit
* unist-util-visit-parents 6.0.2: https://github.com/syntax-tree/unist-util-visit-parents
* use-callback-ref 1.3.3: https://github.com/theKashey/use-callback-ref
* use-debounce 10.1.0: https://github.com/xnimorz/use-debounce
* use-sidecar 1.1.3: https://github.com/theKashey/use-sidecar
* vfile 6.0.3: https://github.com/vfile/vfile
* vfile-location 5.0.3: https://github.com/vfile/vfile-location
* vfile-message 4.0.3: https://github.com/vfile/vfile-message
* victory-vendor 36.9.2: https://github.com/FormidableLabs/victory
* web-namespaces 2.0.1: https://github.com/wooorm/web-namespaces
* zod 4.3.6: https://github.com/colinhacks/zod
* zod-to-json-schema 3.25.1: https://github.com/StefanTerdell/zod-to-json-schema
* zwitch 2.0.4: https://github.com/wooorm/zwitch

== Installation ==

1. Install the plugin from **Plugins > Add New** (search for "AlphaRecall") or upload the zip, then activate it.
2. Open **AlphaRecall** in the admin menu.
3. Read what the service receives, tick "I agree" and click **Connect**. Your account is created and linked to this site.
4. Follow the short setup: choose the content the assistant learns from and how the chat looks. The widget appears on your site once you switch it on in **Customization**.

The site must be reachable from the internet during the connection, because the service confirms the request with a call back to your site.

== Frequently Asked Questions ==

= Do I need an account? =

Yes. The assistant runs on the AlphaRecall service. Connecting the site from the plugin creates the account, which starts with a free trial.

= Does the plugin send anything before I connect? =

No. Until an administrator agrees on the connection screen the plugin makes no request to AlphaRecall or any other service, and the chat widget is not shown.

= Which content does the assistant learn from? =

Only what you select in **Training**: published pages, posts and products, FAQs and documents you upload. You can exclude pages and resync at any time.

= Can a person take over a conversation? =

Yes. From **Messages** you can reply yourself; the assistant pauses while a person handles the chat, and team members can be notified by e-mail.

= Is it GDPR friendly? =

The widget asks for consent before it stores contact details, you can link your privacy notice, set data retention periods, and manage or delete a visitor's data from the dashboard. Whether your site complies with the law depends on how you use it, so check your own privacy notice with your advisor.

= Does the widget show a "Powered by" link? =

Only if you ask for it: there is an optional checkbox on the connection screen. It is off by default. You can turn it off or on again at any time in **Customization > Widget**, on any plan. Developers can also return `true` or `false` from the `alpharecall_show_attribution` filter.

= Where is my data and how do I delete it? =

Conversations, requests and synced content are stored by the AlphaRecall service. You can delete single conversations and visitors from the dashboard, and ask AlphaRecall to delete the whole account using the contact in the Privacy Policy. Deleting the plugin from WordPress removes its local settings and caches.

= Can I build the scripts myself? =

Yes. The sources are in `chat-ui/`; the "Source code" section above lists the steps.

== Screenshots ==

1. The connection screen: what is sent to AlphaRecall, and the explicit consent before the first request.
2. Today: requests to answer, conversations and how the assistant is doing.
3. Messages: every conversation, with human takeover.
4. Requests: contact, quote and appointment requests with their status.
5. Customization: the chat widget editor with a live preview.
6. The chat widget on a website.

== Changelog ==

= 0.1.95 =
* The readme links the public source repository of every library compiled into the scripts, and `chat-ui/BUNDLE-SOURCES.md` lists what each script is compiled from.
* The GPL licence text is included as `license.txt`.

= 0.1.94 =
* Build settings in `chat-ui/` are TypeScript files, and the readme says which source files each script in `assets/` is built from.
* The stylesheet of the shared report is no longer compressed.

= 0.1.93 =
* Removed the connections that were not available in the dashboard: Formidable Forms, Ninja Forms, MailPoet, Amelia, Easy Property Listings, Estatik, Meta Pixel and the restaurant and lodging tools. The plugin now loads no third-party script.
* WooCommerce is set up under Settings > Advanced.

= 0.1.92 =
* The custom CSS field is gone: style the widget with the options in Customization, or with your theme's own Additional CSS.
* Every request body is sanitized as soon as it is read, before any field is used.
* The readme lists every external service, with what is sent and when.
* Diagnostic messages are written to the debug log only when WordPress debugging is on.

= 0.1.91 =
* Numbers in the dashboard use Italian grouping (1.284), chart tooltips follow the dashboard language, and three counts read correctly when the count is one.

Older releases are listed in changelog.txt.

== Upgrade Notice ==

= 0.1.93 =
Connections to Formidable Forms, Ninja Forms, MailPoet, Amelia, Easy Property Listings and Estatik are removed. WooCommerce and Google Calendar stay.

= 0.1.92 =
The custom CSS field is removed: move your rules to your theme's Additional CSS before updating.
