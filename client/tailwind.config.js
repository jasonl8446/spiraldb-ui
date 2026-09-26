/**
 * Tailwind configuration. Task 1.1 only proves the pipeline works; the dark-only
 * palette, surfaces and typography tokens from docs/spec-ui-design.md L18-43 are
 * added in task 1.8.
 *
 * `content` globs are resolved from the process cwd (npm scripts run from the
 * repo root), so they are written repo-relative on purpose.
 */
export default {
  darkMode: 'class',
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
