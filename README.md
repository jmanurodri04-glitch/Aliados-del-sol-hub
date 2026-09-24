# Aliados del Sol · Hub

Programa de aliados de **GEENERA**: sitio público + hub autenticado (demo) para referir empresas,
seguir el avance comercial de cada oportunidad y administrar Puntos Sol, niveles y beneficios.

Sitio **100% estático**. No hay backend, ni paso de build obligatorio, ni dependencias de npm en producción:
React 18 y el runtime de componentes se cargan en el navegador.

---

## Estructura

```
.
├── index.html                     Página completa (entrada del sitio)
├── SolarBuildSequence.dc.html     Animación del hero: construcción de la planta solar
├── GProgress.dc.html              Indicador de progreso sobre la G de GEENERA
├── CommercialJourney.dc.html      Journey comercial de 7 etapas
├── support.js                     Runtime de los componentes (no editar)
├── assets/                        Logos, fotos y placeholders
├── src/
│   └── Aliados del Sol Hub.dc.html   Fuente canónica de index.html
├── scripts/build.mjs              Regenera index.html desde src/
├── docs/
│   ├── HANDOFF.md                 Decisiones de producto y tabla de configuración
│   ├── DESIGN_SYSTEM.md           Colores, tipografía y tokens
│   └── screenshots/               Capturas de referencia
├── vercel.json                    Rutas, cache y headers
└── package.json
```

`index.html` y `src/Aliados del Sol Hub.dc.html` comparten el mismo cuerpo; solo difieren en el `<head>`
(título, meta, Open Graph, favicon). Edita la fuente en `src/` y ejecuta `npm run build`, o edita
`index.html` directamente si prefieres un solo archivo.

## Desarrollo local

```bash
npm run dev          # sirve el sitio en http://localhost:4173
```

Cualquier servidor estático funciona (`python3 -m http.server`, `php -S`, Live Server).
**No abras `index.html` con doble clic**: los componentes se cargan por `fetch` y el protocolo `file://` lo bloquea.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Aliados del Sol Hub: versión inicial"
git branch -M main
git remote add origin git@github.com:<usuario>/aliados-del-sol-hub.git
git push -u origin main
```

## Desplegar en Vercel

1. **Add New → Project** e importa el repositorio.
2. Framework Preset: **Other**.
3. Build Command: *vacío*. Output Directory: *vacío* (raíz). Install Command: *vacío*.
4. **Deploy**.

`vercel.json` ya resuelve el resto: URLs limpias, cache inmutable de un año para `assets/`,
`Content-Type` correcto para los `.dc.html` y fallback de cualquier ruta a `index.html`.

Desde la CLI:

```bash
npx vercel        # preview
npx vercel --prod # producción
```

Tras el primer despliegue, cambia `og:image` en `index.html` por la URL absoluta de tu dominio
(`https://tu-dominio.com/assets/foto-paneles.jpg`) para que las vistas previas en redes funcionen.

## Configuración del programa

Toda la lógica de negocio vive en constantes al final del bloque `<script data-dc-script>` de `index.html`.
Nada está escrito a mano dentro de los componentes: cambia la constante y cambia todo el sitio.

| Constante | Controla |
| --- | --- |
| `POINTS_CONFIG` | Puntos Sol por oportunidad, Academia, misiones, racha y eventos |
| `LEVEL_CONFIG` | Los seis niveles, sus rangos, calidad mínima y beneficios |
| `QUALITY_CONFIG` | Ponderación del Quality Score (40/30/20/10) |
| `STREAK_CONFIG` | Racha Solar 4x4 |
| `OPPORTUNITY_STAGE_CONFIG` | Las 7 etapas del journey comercial |
| `ROLE_CONFIG` · `PERMISSIONS_CONFIG` | Roles, módulos visibles y permisos |
| `ALLY_TYPE_CONFIG` · `ORGANIZATION_CONFIG` | Tipos de aliado y registro por organización |
| `FINANCE_CONFIG` | Entidades financieras aliadas |
| `KPI_CONFIG` · `PARTNER_HEALTH_CONFIG` | Dashboards por rol |
| `LIFECYCLE_CONFIG` | Comunicaciones del ciclo de vida |

Detalle completo de decisiones en [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Estado y pendientes

- Los datos mostrados son **demo**: no hay base de datos ni autenticación real.
- El formulario de referidos apunta a Clientify; falta capturar `ally_id`, `organization_id` y `source`.
- Faltan assets definitivos de gremios y clientes (los cinco bancos ya están).
- Modo oscuro y claro completos, con preferencia persistida.

## Notas técnicas

- Requiere conexión: React 18.3.1 y ReactDOM se cargan desde unpkg con SRI, y la tipografía
  Titillium Web desde Google Fonts. Para un entorno sin salida a internet, descarga esos tres
  archivos a `assets/vendor/` y ajusta las URLs en `support.js` e `index.html`.
- Las fotos están optimizadas a JPEG (~1 MB en total). Los PNG originales en alta resolución
  no están en el repositorio.
- Las animaciones respetan `prefers-reduced-motion`.
