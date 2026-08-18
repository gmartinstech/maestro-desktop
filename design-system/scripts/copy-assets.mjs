// Emits the single distributable stylesheet and ships the brand faces alongside it.
// One flat file (no @import) keeps the design-sync scrape and app consumers on the same bytes.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });

const parts = ['tokens.css', 'components.css'].map((f) =>
  readFileSync(join(src, 'styles', f), 'utf8'),
);
writeFileSync(join(dist, 'maestro-ds.css'), parts.join('\n'), 'utf8');

// The fonts stylesheet ships separately: its url()s stay relative to the fonts dir beside it.
const fontsCss = readFileSync(join(src, 'styles', 'fonts.css'), 'utf8').replaceAll(
  '../fonts/',
  './fonts/',
);
writeFileSync(join(dist, 'fonts.css'), fontsCss, 'utf8');

const fontsOut = join(dist, 'fonts');
mkdirSync(fontsOut, { recursive: true });
for (const file of readdirSync(join(src, 'fonts'))) {
  copyFileSync(join(src, 'fonts', file), join(fontsOut, file));
}

console.log('assets: maestro-ds.css, fonts.css, fonts/');
