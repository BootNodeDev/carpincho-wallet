// Read-only gates only. The formatter runs first, from .lintstagedrc.format.mjs, so these are safe
// to run concurrently with each other.
export default {
  '{src,test}/**/*.{ts,tsx}': () => 'pnpm test',
  // Dead code and unused dependencies only show up against the whole graph, so one task for the
  // whole repo rather than a per-file run.
  '**/*.{ts,tsx,css,json}': () => 'pnpm knip',
}
