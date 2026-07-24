export default {
  '**/*.{ts,tsx,js,jsx,json,jsonc,mjs,cjs,css}': 'biome check --write --no-errors-on-unmatched',
  'src/**/*.{ts,tsx,js,jsx}': () => 'pnpm test',
}
