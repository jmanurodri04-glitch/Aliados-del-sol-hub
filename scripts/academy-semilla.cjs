// Genera la migración con el catálogo inicial de la Academy (CLAUDE.md §4.9) a partir de los archivos de la Academy que
// se subieron a `main` (academy-data.js, academy-content-1..10.js y academy-tools.js). Se usó una sola vez; desde ahí el
// catálogo se administra en el panel. Uso: node scripts/academy-semilla.cjs <carpeta con esos archivos> <salida.sql>
const path = require('node:path');
const fs = require('node:fs');

const [dir, salida] = process.argv.slice(2);
if (!dir || !salida) { console.error('Uso: node scripts/academy-semilla.cjs <carpeta> <salida.sql>'); process.exit(1); }

global.window = {};
for (let i = 1; i <= 10; i++) require(path.resolve(dir, `academy-content-${i}.js`));
require(path.resolve(dir, 'academy-data.js'));
const A = window.ADS_ACADEMY;

const lit = (v) => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const arr = (a) => `array[${a.map(lit).join(', ')}]::text[]`;
const json = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const icono = (svg) => Object.keys(A.ICONS).find((k) => A.ICONS[k] === svg) || 'book';

const partes = [`-- Catálogo inicial de la Academy (generado con scripts/academy-semilla.cjs desde los archivos de main, oct 2026).
-- Idempotente: se puede volver a ejecutar sin duplicar nada. Desde aquí el catálogo se administra en el panel.
`];

partes.push('-- Herramientas (sin archivo: su material está incorporado en academy-tools.js)');
A.TOOLS.forEach((t, i) => {
  partes.push(`insert into public.academy_herramientas (codigo, nombre, categoria, icono, descripcion, acceso, orden)
values (${lit(t.id)}, ${lit(t.name)}, ${lit(t.cat)}, ${lit(icono(t.icon))}, ${lit(t.desc)}, ${lit(t.access)}, ${i + 1})
on conflict (codigo) do nothing;`);
});

partes.push('\n-- Minicursos y su contenido (+5 Puntos Sol cada uno, salvo la masterclass)');
A.COURSES.forEach((c, i) => {
  const K = c.content;
  const contenido = {
    aprenderas: K.learn,
    contexto: K.contexto,
    lecciones: c.lessons.map((l) => ({ titulo: l.t, texto: l.b })),
    ejercicio: K.aplica,
    pasos: K.pasos || [],
    quiz: c.quiz.map((q) => ({ pregunta: q.q, opciones: q.o, correcta: q.a })),
    accion: K.activa
  };
  const ruta = c.learningPath && /^e[1-4]$/.test(c.learningPath) ? c.learningPath : null;
  partes.push(`with m as (
  insert into public.modulos (codigo, nombre, orden, activo, puntos, escuela, formato, minutos, nivel, aliados, acceso,
                              destacado, nuevo, popular, rapido, ruta, descripcion, herramienta, popularidad, publicado)
  values (${lit(c.id)}, ${lit(c.title)}, ${100 + i}, true, ${c.format === 'masterclass' ? 0 : 5}, ${lit(c.school)}, ${lit(c.format)},
          ${c.duration}, ${lit(c.level)}, ${arr(c.allyType)}, ${lit(c.access)}, ${c.featured}, ${c.new}, ${c.popular}, ${c.quick},
          ${lit(ruta)}, ${lit(c.shortDescription)}, ${lit(c.tools[0])}, ${c.popularity}, ${lit(c.publishDate)})
  on conflict (codigo) do update set nombre = excluded.nombre
  returning id
)
insert into public.modulos_contenido (modulo_id, contenido)
select id, ${json(contenido)} from m
on conflict (modulo_id) do nothing;`);
});

partes.push('\n-- Certificaciones');
A.CERTS.forEach((c, i) => {
  partes.push(`insert into public.academy_certificaciones (codigo, nombre, descripcion, escuela, sigla, cursos, orden)
values (${lit(c.id)}, ${lit(c.name)}, ${lit(c.desc)}, ${lit(c.school)}, ${lit(c.mark)}, ${arr(c.courses)}, ${i + 1})
on conflict (codigo) do nothing;`);
});

fs.writeFileSync(salida, partes.join('\n') + '\n');
console.log(`${A.COURSES.length} cursos, ${A.CERTS.length} certificaciones, ${A.TOOLS.length} herramientas → ${salida}`);
