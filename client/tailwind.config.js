/**
 * Tailwind configuration — the dark-only design tokens from
 * docs/spec-ui-design.md L18-43: zinc-950 background, zinc-900 cards/panels,
 * zinc-800 borders and elevated surfaces, zinc-50/400/500 text, blue-600 accent,
 * amber-500 / blue-500 / emerald-500 status colors, Inter + JetBrains Mono.
 *
 * The palette is exposed twice on purpose:
 *
 * - the literal Tailwind names (`bg-zinc-950`, `text-blue-400`, …) that the spec
 *   quotes verbatim and the shell uses directly, and
 * - the semantic shadcn/ui aliases (`bg-background`, `bg-card`, `border-input`,
 *   `ring-ring`, …) that the vendored primitives under `client/src/components/ui`
 *   are written against — same style as upstream shadcn/ui. Those aliases resolve
 *   to the CSS variables declared in `client/src/index.css`, so a primitive can
 *   never drift from the spec palette: the variable values *are* the tokens.
 *
 * `content` globs are resolved from the process cwd (npm scripts run from the
 * repo root), so they are written repo-relative on purpose.
 */
import animate from 'tailwindcss-animate';

/** Tailwind's default sans stack with Inter first (spec-ui-design.md L34-35). */
const fontSans = [
  'Inter',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
];

/** JetBrains Mono for JSON preview, IDs and code snippets (spec-ui-design.md L37). */
const fontMono = [
  'JetBrains Mono',
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Consolas',
  'Liberation Mono',
  'monospace',
];

export default {
  darkMode: 'class',
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)', // 8px — cards (spec-ui-design.md L42)
        md: 'calc(var(--radius) - 2px)', // 6px — inputs/buttons
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: fontSans,
        mono: fontMono,
      },
    },
  },
  plugins: [animate],
};
