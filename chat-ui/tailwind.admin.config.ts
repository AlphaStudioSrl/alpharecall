import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import scopedPreflight from "./build-tools/scoped-preflight";

/**
 * A design token (admin.css, --ar-*) as a Tailwind color that still takes an
 * opacity modifier: bg-fill, text-ink-3, bg-tone-warn-soft, text-ink/60.
 */
const token = (name) => `color-mix(in srgb, var(--ar-${name}) calc(<alpha-value> * 100%), transparent)`;

/**
 * Sources that no production build uses are not scanned for class names, so
 * admin.css holds the classes of the pages that ship and rebuilds the same
 * from the sources in the WordPress.org package (which leaves the dev harness out).
 */
const notBuilt = process.env.NODE_ENV === "production"
  ? ["!./src/admin/dev/**", "!./src/admin/**/__tests__/**"]
  : [];

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  corePlugins: { preflight: false },
  content: [
    "./src/admin/**/*.{ts,tsx}",
    "./src/components/ui/**/*.{ts,tsx}",
    "./src/components/chat/**/*.{ts,tsx}",
    "./src/components/tambo/markdown-components.tsx",
    "./src/components/icons/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
    ...notBuilt,
  ],
  important: ":is(#alpharecall-admin-app, [data-ar-portal])",
  theme: {
    extend: {
      colors: {
        // Mockup tokens (admin.css). Prefer these for new work; the shadcn
        // names below map onto them.
        canvas: token("canvas"),
        panel: token("panel"),
        fill: { DEFAULT: token("fill"), 2: token("fill-2") },
        ink: { DEFAULT: token("ink"), 2: token("ink-2"), 3: token("ink-3") },
        "on-ink": token("on-ink"),
        tone: {
          accent: token("accent"),
          "accent-soft": token("accent-soft"),
          "accent-ink": token("accent-ink"),
          warn: token("warn"),
          "warn-soft": token("warn-soft"),
          info: token("info"),
          "info-soft": token("info-soft"),
          violet: token("violet"),
          "violet-soft": token("violet-soft"),
          red: token("red"),
          "red-soft": token("red-soft"),
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        panel: "var(--ar-r-panel)",
        group: "var(--ar-r-group)",
        control: "var(--ar-r-control)",
        modal: "var(--ar-r-modal)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        panel: "var(--ar-sh-panel)",
        float: "var(--ar-sh-float)",
        selected: "var(--ar-sh-selected)",
      },
      keyframes: {
        "collapsible-down": {
          from: { height: "0px", opacity: "0" },
          to: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
          to: { height: "0px", opacity: "0" },
        },
      },
      animation: {
        "collapsible-down": "collapsible-down 0.22s ease-out",
        "collapsible-up": "collapsible-up 0.18s ease-in",
      },
      fontFamily: {
        sans: [
          "Geist Variable",
          "Geist",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [scopedPreflight, animate],
} satisfies Config;
