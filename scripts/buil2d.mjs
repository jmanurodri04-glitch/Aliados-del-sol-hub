// Regenera index.html a partir de src/Aliados del Sol Hub.dc.html,
// conservando el <head> de producción que ya vive en index.html.
import { readFile, writeFile } from 'node:fs/promises';

const SRC = 'src/Aliados del Sol Hub.dc.html';
const OUT = 'index.html';

const src = await readFile(SRC, 'utf8');
const out = await readFile(OUT, 'utf8');
const head = out.slice(0, out.indexOf('<body>'));
const body = src.slice(src.indexOf('<body>'));
if (!head || !body) throw new Error('No se encontró <body> en index.html o en la fuente');
await writeFile(OUT, head + body);
console.log('index.html regenerado desde ' + SRC);
