/**
 * PostCSS pipeline for the client. `tailwindcss` is pointed at the config
 * explicitly because npm scripts run from the repo root while the config lives
 * next to this file.
 */
export default {
  plugins: {
    tailwindcss: { config: './client/tailwind.config.js' },
    autoprefixer: {},
  },
};
