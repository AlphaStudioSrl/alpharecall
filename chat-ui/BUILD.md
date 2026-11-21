# Building the JavaScript and CSS bundles

The files in `assets/js` and `assets/css` are built from the sources in this
folder (React + TypeScript, bundled with Vite). To rebuild them:

```bash
cd chat-ui
npm ci
npm run build                 # assets/js/chat.js, assets/css/chat.css and assets/js/chat-maps.js
npm run build:admin           # assets/js/admin.js, its chunks in assets/js/admin-chunks/ and assets/css/admin.css
```

Node.js 20 or newer is required. The build settings are the `vite.*.config.ts`
and `tailwind.*.ts` files next to this one. Tests and development tools are not
part of the plugin package.

Entry points: `src/main.tsx` (widget), `src/maps-runtime/main.ts` (map) and
`src/admin/main.tsx` (dashboard).

`BUNDLE-SOURCES.md` lists, for each script in `assets/js`, the source files and
the npm packages it is compiled from; the plugin's `readme.txt` links the source
repository of every package. `THIRD-PARTY-LICENSES.md` carries their licences,
copyright notices and licence texts.
