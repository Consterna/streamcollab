**English** | [Español](#cómo-contribuir)

# Contributing

Thanks for helping with StreamCollab! Bug reports, fixes, translations and documentation are all welcome.

- **Bugs and ideas:** open an issue with the bug report or feature request form.
- **Vulnerabilities:** never in a public issue, see [SECURITY.md](SECURITY.md).
- **Code of Conduct:** all contributors must adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).
- **Accessibility:** UI changes must keep the accessibility checks passing (`e2e/a11y.spec.ts`, WCAG 2.1 AA rules) and follow our [Accessibility Statement](../docs/ACCESSIBILITY.md).

## Setup

You need **Node.js 24** or newer (it ships with npm 11).

```bash
git clone https://github.com/Consterna/streamcollab.git && cd streamcollab
npm ci
npm run check    # lint, format check, typecheck and unit / integration tests
npm run build
npx playwright install chromium   # once, before the first end-to-end run
npm run e2e      # Playwright end-to-end tests against the compiled server
```

> On Windows PowerShell, use `npm.cmd` / `npx.cmd` if script execution is blocked.

For day-to-day work run `npm run dev:server` and `npm run dev:client` in two terminals and open
`http://localhost:5173/?view=dashboard`. The README's [Developer Workflow](../README.md#developer-workflow) table lists every script.

## Making a change

1. Branch from `main` and keep each pull request focused on one change.
2. Add or update tests next to the code you change (`packages/*/test/`, `e2e/`).
3. Run `npm run check` before pushing; CI runs the same checks plus the end-to-end tests and a Docker smoke test.
4. Formatting: Prettier and ESLint (`npm run lint`, `npm run format`). Markdown files are not auto-formatted.
5. Keep LF line endings in YAML, shell, Lua and Docker files (see `.gitattributes`).

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), as in the existing history: `feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `build:`, `ci:`, `style:`, `chore:`, optionally with a scope, e.g.
`feat(dock): native OBS recording chapters` or `fix(client): ...`.

### Two languages, always

StreamCollab is bilingual (English and Spanish), and so is its documentation:

- **Every user-facing document is updated in both languages** in the same pull request: the English file (`*.md`,
  the one GitHub shows) and its Spanish twin (`*.es.md`), e.g. `README.md` / `README.es.md`, `docs/stream-deck.md` /
  `docs/stream-deck.es.md`. The first line of each holds the language selector
  (`**English** | [Español](X.es.md)` and `[English](X.md) | **Español**`).
- **Every CHANGELOG entry goes in both `CHANGELOG.md` and `CHANGELOG.es.md`**, under `## [Unreleased]`, following
  [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Keep version headings exactly as `## [x.y.z] - YYYY-MM-DD`:
  the release notes are taken from the section between one `## [` heading and the next.
- **Every interface string** goes in both `packages/client/src/i18n/en.ts` and `packages/client/src/i18n/es.ts`;
  a test fails if the two dictionaries don't have the same keys and placeholders.

If you can only write one of the languages, say so in the pull request and we will help with the other one.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE).

---

# Cómo contribuir

[English](#contributing) | **Español**

¡Gracias por ayudar con StreamCollab! Son bienvenidos los informes de errores, las correcciones, las traducciones y la documentación.

- **Errores e ideas:** abre un issue con el formulario de error o de propuesta.
- **Vulnerabilidades:** nunca en un issue público, consulta [SECURITY.md](SECURITY.md).
- **Código de conducta:** todos los colaboradores deben cumplir con nuestro [Código de conducta](CODIGO_DE_CONDUCTA.md).
- **Accesibilidad:** los cambios de interfaz deben mantener en verde las comprobaciones de accesibilidad (`e2e/a11y.spec.ts`, reglas WCAG 2.1 AA) y seguir nuestra [Declaración de accesibilidad](../docs/ACCESSIBILITY.es.md).

## Preparar el entorno

Necesitas **Node.js 24** o superior (incluye npm 11).

```bash
git clone https://github.com/Consterna/streamcollab.git && cd streamcollab
npm ci
npm run check    # lint, comprobación de formato, typecheck y tests unitarios / de integración
npm run build
npx playwright install chromium   # una vez, antes de la primera prueba end-to-end
npm run e2e      # tests end-to-end con Playwright contra el servidor compilado
```

> En Windows PowerShell, usa `npm.cmd` / `npx.cmd` si la ejecución de scripts está bloqueada.

Para el trabajo diario, ejecuta `npm run dev:server` y `npm run dev:client` en dos terminales y abre
`http://localhost:5173/?view=dashboard`. La tabla [Flujo de trabajo](../README.es.md#flujo-de-trabajo) del README lista todos los scripts.

## Hacer un cambio

1. Crea una rama desde `main` y dedica cada pull request a un solo cambio.
2. Añade o actualiza tests junto al código que cambias (`packages/*/test/`, `e2e/`).
3. Ejecuta `npm run check` antes de subir los cambios; la CI ejecuta las mismas comprobaciones, más los tests end-to-end y una prueba de la imagen Docker.
4. Formato: Prettier y ESLint (`npm run lint`, `npm run format`). Los archivos Markdown no se formatean automáticamente.
5. Mantén los saltos de línea LF en los archivos YAML, shell, Lua y Docker (ver `.gitattributes`).

### Mensajes de commit

Usa [Conventional Commits](https://www.conventionalcommits.org/es/), como en el historial existente: `feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `build:`, `ci:`, `style:`, `chore:`, con un ámbito opcional, p. ej.
`feat(dock): native OBS recording chapters` o `fix(client): ...`.

### Dos idiomas, siempre

StreamCollab es bilingüe (inglés y español), y su documentación también:

- **Toda la documentación de usuario se actualiza en los dos idiomas** en el mismo pull request: el archivo en inglés
  (`*.md`, el que muestra GitHub) y su gemelo en español (`*.es.md`), p. ej. `README.md` / `README.es.md`,
  `docs/stream-deck.md` / `docs/stream-deck.es.md`. La primera línea de cada uno lleva el selector de idioma
  (`**English** | [Español](X.es.md)` y `[English](X.md) | **Español**`).
- **Cada entrada del CHANGELOG va en `CHANGELOG.md` y en `CHANGELOG.es.md`**, bajo `## [Unreleased]`, siguiendo
  [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/). Mantén las cabeceras de versión exactamente como
  `## [x.y.z] - AAAA-MM-DD`: las notas de la release se toman de la sección entre una cabecera `## [` y la siguiente.
- **Cada texto de la interfaz** va en `packages/client/src/i18n/en.ts` y en `packages/client/src/i18n/es.ts`;
  un test falla si los dos diccionarios no tienen las mismas claves y marcadores de posición.

Si solo puedes escribir en uno de los dos idiomas, dilo en el pull request y te ayudaremos con el otro.

## Licencia

Al contribuir, aceptas que tus contribuciones se publiquen bajo la [licencia MIT](../LICENSE).
