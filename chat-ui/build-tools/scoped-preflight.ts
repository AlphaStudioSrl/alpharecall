import fs from "node:fs";
import { createRequire } from "node:module";
import postcss from "postcss";
import plugin from "tailwindcss/plugin";

const require = createRequire(import.meta.url);

// WordPress owns the document. Tailwind's normal preflight resets every host
// input/button/heading, even when utilities use an `important` selector.
export default plugin(({ addBase }) => {
  const scope = ":where(#alpharecall-admin-app, .ar-chat-shell, .lp-root, [data-ar-portal])";
  const css = postcss.parse(fs.readFileSync(require.resolve("tailwindcss/lib/css/preflight.css"), "utf8"));
  css.walkRules(rule => {
    rule.selectors = rule.selectors.map(selector =>
      ["html", ":host", "body"].includes(selector) ? scope : `${scope} ${selector}`
    );
  });
  addBase(css.nodes);
});
