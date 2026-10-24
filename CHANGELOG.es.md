[English](CHANGELOG.md) | **Español**

# Registro de cambios

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/)
y este proyecto se adhiere al [Versionado Semántico](https://semver.org/lang/es/spec/v2.0.0.html).

## [Unreleased]

### Seguridad
- **zod 4.6.7:** las versiones de zod anteriores a la 4.6.6 podían agotar la memoria al validar arrays grandes ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), alta). Los límites de StreamCollab (cuerpos de 64 KB, mensajes WebSocket de 16 KB) ya lo acotaban.
- **Credenciales por servidor:** un enlace con `?server=` podía hacer que la página enviara a otro servidor los tokens de host y de miembro que tenía guardados. Ahora los tokens y el id de miembro se guardan por servidor; las credenciales guardadas por versiones anteriores solo se usan con otro servidor si lo aceptas en un aviso que lo nombra.
- Los códigos de sala desconocidos cuentan por IP en la API REST y en el WebSocket a la vez (antes solo se limitaban las uniones por WebSocket), y un código de sala personalizado necesita al menos 8 caracteres.
- Los sockets que salen de su sala, o cuya sala se borra, se cierran al pasar el tiempo de espera de unión; las conexiones WebSocket simultáneas por IP tienen un tope (`MAX_SOCKETS_PER_IP`, 64 por defecto). Detrás de un proxy inverso, pon `TRUST_PROXY=true` para que estos límites se apliquen por cliente y no a todos juntos.

### Corregido
- **EDL de DaVinci Resolve:** la exportación usa ahora el formato que escribe el propio Resolve con *Timeline Markers to EDL* (`|C:ResolveColor<Color> |M:<nombre> |D:1` tras cada evento), que se importa con *Timelines → Import → Timeline Markers from EDL*. Las versiones anteriores escribían localizadores `* LOC:` al estilo de Avid. Los marcadores `White` pasan a `Cream` de Resolve, y los marcadores que varios streamers pusieron en el mismo fotograma se unen en uno con todos sus nombres (Resolve guarda un marcador por fotograma).
- **Sesiones:** detener una sesión ya detenida movía su hora de fin y dejaba huérfana la sesión en curso; un marcador pulsado después de que el host detuviera la sesión podía guardarse en ella (uno pulsado justo antes del Stop sigue guardándose ahí); un `BEGIN` fallido (base de datos ocupada) desactivaba en silencio todas las transacciones posteriores; `SESSION_STOPPED` podía anunciarse para un cambio que luego se deshacía.
- **Reinicios:** tras un reinicio normal (un despliegue), las sesiones en curso continúan en lugar de cerrarse en su último marcador; tras una caída, se cierran en el último latido del servidor. Los miembros ya no aparecen grabando hasta que su Dock se reconecta, así que una sesión iniciada mientras tanto no ancla un archivo de grabación obsoleto.
- **Base de datos:** la migración v5 repara las sesiones que la migración v4 podía cerrar antes de empezar; una base de datos escrita por un StreamCollab más nuevo se rechaza, y el archivo ya no se queda abierto (bloqueado en Windows) cuando no se puede usar.
- Exportar una sesión que no existe devolvía el archivo de otra sesión; ahora responde 404. Un parámetro de consulta repetido respondía 500; ahora responde 400.
- Deshacer (`0`, `Ctrl+Z`, HTTP) solo alcanza la sesión en curso, como estaba documentado.
- Una Auto Session (la que abre un marcador cuando no hay sesión) empieza ahora en esa pulsación, así que los marcadores justo después conservan su separación real en vez de caer todos en su primer fotograma.
- Una actualización de estado parcial podía guardar un framerate de OBS imposible.
- `PORT=`, `HOST=`, `LOG_LEVEL=` o `ROOM_CREATE_LIMIT_PER_MINUTE=` vacíos en el `.env` impedían arrancar el servidor; ahora significan "valor por defecto".
- **Conexión con OBS:** pulsar Conectar dos veces (o el modo de desarrollo de React) podía iniciar un bucle de reconexión sin fin.
- **Conexión con el servidor:** la espera entre reconexiones no crecía cuando el servidor aceptaba y luego cerraba el socket; una sala borrada o inexistente se volvía a unir en cada reconexión; la sincronización del reloj podía rechazar todas las muestras para siempre si la red se volvía más lenta.
- **Almacenamiento bloqueado:** en un perfil de navegador u OBS con el almacenamiento bloqueado, la Dock perdía su token de miembro al momento, así que cada reconexión era rechazada y volvía como un miembro nuevo. Ahora las credenciales se guardan en memoria durante la carga de la página.
- **Dock:** un nombre de más de 40 caracteres dejaba la Dock fuera de todas las salas; el texto de un marcador personalizado de más de 80 caracteres se perdía (y se guardaba dos veces, como etiqueta y como comentario); los atajos se disparaban al mantener la tecla, con `Ctrl`/`Alt`/`Cmd` y detrás de un diálogo abierto.
- **Panel del director:** un timecode base no válido cerraba el diálogo de inicio y la sesión nunca empezaba; el historial de sesiones de la sala anterior seguía visible tras cambiar de sala; `?room=` hacía que una recarga volviera a la sala de la invitación.
- Los nombres de archivo exportados eliminan los caracteres que Windows prohíbe; "Copiar" ya no falla en silencio cuando el navegador rechaza el portapapeles; la categoría de la línea de tiempo se traduce; los errores de la API conservan un prefijo traducido; el mensaje `TIMEOUT` ya no sustituye al aviso de la sala.
- El XML de FCP 7 escribe el timecode base con `;` en las sesiones drop-frame.
- Los nombres de archivo RFC 5987 codifican `' ( ) *`.

### Accesibilidad
- Los diálogos mantienen el foco del teclado dentro y lo devuelven al cerrarse (cerrar con Escape y el soporte de movimiento reducido también se añadieron después de la 1.6.1).
- Contraste de texto subido al menos a 4,5:1 donde axe encontró menos; etiquetas añadidas a los campos de filtro, búsqueda, categoría y ajustes de OBS.
- La declaración de accesibilidad se reescribe para decir solo lo que se prueba (reglas WCAG 2.1 A/AA de axe-core en las pantallas principales, en los dos idiomas) y lo que aún no (lectores de pantalla, Firefox, Safari).

### Tests
- Tests de componentes en un Chromium real (Vitest Browser Mode), escaneos de accesibilidad con axe-core en la suite end-to-end, umbrales de cobertura sobre todos los archivos fuente y tests de regresión para cada corrección anterior.
- El test de estrés de la base de datos ahora intercala de verdad sus 20 escritores y hace la copia en caliente en medio de ellos (antes se ejecutaban uno tras otro y la copia, después de todos).
- Mutation testing del motor de timecode y los exportadores con Stryker, bajo demanda (`stryker.config.mjs`).

### Cambiado
- `@fastify/cors` 11, `@fastify/rate-limit` 11.2.1, `@fastify/static` 10.1.7, vite 8.3.5, lucide-react 1.61.
- Código de conducta, declaración de accesibilidad y sus versiones en español (los archivos en español están junto a los ingleses).
- El workflow de release puede volver a ejecutarse sobre una release existente (actualiza las notas y los assets).

## [1.6.1] - 2026-10-22

### Añadido
- Cobertura de pruebas integral alcanzando 216 tests en total (201 tests unitarios y de integración con Vitest en 23 suites + 15 tests E2E con Playwright).
- Pruebas basadas en propiedades (property-based testing) con `fast-check` verificando la biyectividad del timecode SMPTE en las 8 tasas estándar (60, 59.94, 50, 30, 29.97, 25, 24, 23.976 fps), precisión sub-milisegundo, cambio de ciclo de 24 horas y límites de minutos en drop frame.
- Pruebas estrictas de conformidad para exportadores: EDL CMX 3600 (saltos de línea CRLF, localizadores de color de DaVinci Resolve), XML Final Cut Pro 7 (validez estricta de esquema XML 1.0 con DOMParser) y fuzzing de inyección de fórmulas CSV.
- Pruebas de estrés y concurrencia de base de datos (20 workers concurrentes, 2.000 escrituras/s durante backups en caliente, conciliación de sesiones huérfanas en el arranque).
- Pruebas de caos y resiliencia WebSocket (ráfagas de límite de tasa, tormentas de reconexión con 30 sockets, cargas útiles de 16KB, fuzzing de JSON malformado, timeout de 15s para sockets sin sala).
- Suite de integración simulada de OBS WebSocket v5 verificando el ciclo completo de grabación (start/pause/resume/stop), cambios dinámicos de FPS en el lienzo, deduplicación de señales de hotkey Lua y respaldo ante errores de formato de capítulos nativos.
- Suite E2E extendida en Playwright (`e2e/squad-extended.spec.ts`) validando la sincronización multi-streamer, descarga de los 5 formatos de exportación (.edl, .xml, .csv, .txt, .json) y docks OBS ultra-estrechos (300px y 360px) en español sin desbordamiento.
- Política de seguridad (`SECURITY.md`), guía para contribuir (`CONTRIBUTING.md`) y plantillas de issues y pull requests de GitHub.

### Cambiado
- **Rendimiento HUD en OBS CEF:** Optimizado el intervalo del limpiador de toasts en `HudView.tsx` para preservar la identidad de la referencia cuando ningún toast expira, eliminando por completo 5 re-renderizados por segundo en reposo en fuentes del navegador OBS CEF.
- **Resiliencia WebSocket:** Ráfaga inicial de 4 pings SNTP al conectar, descarte de picos extremos de jitter (> 2.5x base y > 100ms), backoff exponencial en el cliente hasta 15s y deduplicación de avisos `onConnectionChange` garantizando avisos en fallo inicial.
- **Concurrencia SQLite y recuperación:** `PRAGMA busy_timeout = 5000;` en todas las conexiones y copias en caliente para erradicar errores de contención `SQLITE_BUSY`, transacciones multi-sentencia atómicas con protección contra reentrada y conciliación automática de sesiones huérfanas al iniciar.
- **Imagen Docker en GHCR:** `ghcr.io/consterna/streamcollab` (`linux/amd64`, `linux/arm64`). `docker-compose.yml` la usa por defecto (`STREAMCOLLAB_TAG`, con `build: .` como respaldo).
- Las GitHub Releases incluyen el script Lua de OBS (`streamcollab-hotkeys.lua`), `SHA256SUMS` y una attestation de procedencia de la compilación.
- Documentación en inglés y español (`README`, `CHANGELOG`, `docs/`); el README incorpora un inicio rápido para usuarios (Docker, VPS) antes de la guía de desarrollo.
- `engines.node >= 24`.
- Quitar a un miembro desconectado (`REMOVE_MEMBER`) ahora solo lo saca de esa sala: su member id sigue ligado a su Dock, así que ningún otro dispositivo puede reclamarlo después.

### Corregido
- **Timecode dropFrame en EDL y XML:** Corregido `tc.dropFrame` en `packages/shared/src/exporters/edl.ts` y `xml.ts` para usar la configuración drop-frame del timecode.
- **Limpieza de caracteres de control en XML:** Eliminados caracteres de control no permitidos en XML 1.0 (`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`) en `escapeXml` para evitar exportaciones FCP XML corruptas.
- **La identidad de miembro era global entre salas:** cuando una Dock entraba en otra sala, su streamer desaparecía de la sala anterior, de la matriz de sincronización multicámara de esa sala y de su quick-mark HTTP. La pertenencia ahora es por sala (migración del esquema v4); la identidad de la Dock y su member token se comparten en todas las salas a las que entra.
- **Capítulos de YouTube:** el primer capítulo podía empezar después de `00:00` (YouTube exige el primer capítulo en 00:00, al menos 3 marcas de tiempo y capítulos de 10 s o más). La exportación ahora siempre empieza en `00:00` y el diálogo de exportación avisa cuando hay menos de 3 capítulos.
- **Los títulos EDL** perdían las letras acentuadas ("Sesión" → "Sesin"); ahora se simplifican a ASCII ("Sesion").
- **Los framerates no estándar** producían timecodes `NaN`. Las sesiones ahora solo aceptan las 8 tasas soportadas (60, 59.94, 50, 30, 29.97, 25, 24 y 23.976 fps), con drop frame solo a 29.97 y 59.94, y se rechaza una Dock que informa de un framerate de OBS imposible. El motor de timecode ya no descarta frames a 30 / 60 fps enteros cuando se pide drop frame (solo las tasas NTSC descartan frames); el Panel del director desactiva la opción de drop frame en las demás tasas.
- **Sesiones huérfanas:** iniciar una sesión con otra en marcha dejaba la anterior abierta y no se podía borrar. Ahora la sesión en marcha se detiene primero, y la migración cierra las huérfanas existentes.
- Al entrar en una sala sin sesión activa se enviaban todos los marcadores de todas las sesiones; ahora se envía la sesión más reciente con sus marcadores, que se puede seguir exportando tras recargar.
- La Dock enviaba actualizaciones de estado antes de haber entrado en la sala, y el aviso traducido "la sala no existe / fue borrada" se sustituía cada segundo por "Join a room first".
- La Dock no indicaba que había perdido la conexión con el servidor y los marcadores se perdían sin aviso. Ahora muestra **Servidor desconectado** y avisa del marcador que no se envió (su capítulo nativo de OBS, si está activado, se sigue escribiendo en tu grabación).
- Al filtro de categorías del Panel del director le faltaba la opción `custom`.
- La categoría del historial de marcadores de la Dock no estaba traducida.
- Los atajos `1`–`5` y `0` se disparaban con un desplegable enfocado.
- El favicon apuntaba a un `/vite.svg` inexistente (404).
- Los archivos sin hash del build del cliente (como el favicon) se cacheaban como inmutables durante 30 días; ahora solo los `/assets/` con hash, y el resto se revalida.
- Los códigos de error `FORBIDDEN`, `NOT_FOUND` e `INVALID_MESSAGE` no estaban traducidos.
- Accesos a `localStorage` sin proteger en perfiles de OBS con el almacenamiento del navegador bloqueado.
- **Rechazo de jitter 0ms en SNTP:** Gestión adecuada de calibraciones con jitter cero en red local/bucle sin falsos positivos de descarte.
- **Acotación de marcas en recuperación tras caídas:** Límites de tiempo acotados dentro del rango de la sesión al conciliar sesiones huérfanas en el arranque.
- **Acotación de duraciones en exportadores:** Prevención de fotogramas negativos en exportaciones EDL y XML ante desajustes de reloj.
- **Creación atómica de sesiones:** `startSession` envuelto en una transacción atómica de SQLite para evitar condiciones de carrera en inicios concurrentes.

### Seguridad
- Expresión regular de fórmulas CSV endurecida a `/^\s*[=+\-@|]|[\t\r]/`, previniendo inyección de fórmulas en hojas de cálculo Excel y Google Sheets.

## [1.6.0] - 2026-10-21

### Añadido
- **Interfaz en español / inglés** con selector en la barra de navegación, enlaces `?lang=`, detección del idioma del navegador, errores del servidor traducidos y etiquetas de marcador por defecto en cada idioma.
- **Sonidos opcionales de aviso en el HUD** (`&sound=1&volume=0..1`), sintetizados por categoría con Web Audio; enlace de invitación "HUD con sonido".
- **Reconexión automática a OBS** en la Dock (espera de 2 s a 30 s) y dirección / contraseña de OBS recordadas por perfil de OBS.
- **Limpieza de salas para el host:** quitar miembros desconectados, borrar sesiones terminadas, borrar la sala (`DELETE /api/rooms/:id/sessions/:sid`, `DELETE /api/rooms/:id`, `REMOVE_MEMBER`).
- Presencia de miembros (`online`), mostrada como OFFLINE · "visto por última vez" en el Panel del director; el HUD en pantalla solo lista a los compañeros conectados.
- **Copias en caliente:** `npm run backup` (`VACUUM INTO` de SQLite, con comprobación de integridad, nunca sobrescribe).
- **Tests end-to-end** con Playwright (10 escenarios, OBS simulado) y un job `e2e` en CI; lista de comprobación `docs/local-testing.md` para OBS real.
- Ajuste `ROOM_CREATE_LIMIT_PER_MINUTE`.

### Cambiado
- Los códigos de sala se aceptan en mayúsculas o minúsculas.
- `no-explicit-any` es un error en el código de la aplicación (las filas de SQLite están tipadas).
- El README ya no afirma un rendimiento no verificable ("60 FPS GPU" / "sub-millisecond"); documenta la función de sonido real.

### Corregido
- El nombre de streamer generado por defecto cambiaba en cada carga de página.
- En Docks estrechas de OBS (≈420 px), el código de sala, el selector de idioma y el botón Deshacer quedaban fuera de la pantalla.
- Las etiquetas del diálogo de sesión no estaban asociadas a sus campos (accesibilidad).
- Los miembros desconectados se mostraban como IDLE, igual que los conectados.

### Seguridad
- Una IP que prueba más de 20 códigos de sala inexistentes por minuto por WebSocket queda bloqueada el resto de ese minuto.

## [1.5.1] - 2026-10-21

### Corregido
- Abrir **OBS Overlay HUD** desde la navegación de la app no dejaba forma de volver (el HUD oculta la navegación para que se vea limpio en OBS). Ahora se abre como vista previa con un botón flotante **Back** (también `Esc`) y un botón **Copy OBS link**; el enlace que se usa en OBS (`?view=hud&room=...`) sigue mostrando el overlay sin nada más.
- Cambiar de vista ahora actualiza `?view=` en la URL en lugar del hash `#`, así que recargar mantiene la vista actual y URLs como `?view=dock...#/hud` ya no se contradicen.

## [1.5.0] - 2026-10-21

### Añadido
- **Capítulos nativos en la grabación de OBS**: la Dock escribe cada marcador como capítulo en la grabación del propio streamer mediante `CreateRecordChapter` (obs-websocket 5.5 / OBS 30.2+, Hybrid MP4). El soporte se detecta con `GetVersion.availableRequests`; los capítulos rechazados (p. ej. por un formato distinto de Hybrid MP4) se indican en los ajustes de la Dock. Opcional: escribir también los marcadores de los compañeros. Las preferencias se guardan por dispositivo.
- **Deshacer**: `UNDO_LAST_MARKER` borra el marcador más reciente de la propia Dock (se resuelve en el servidor). Botón Deshacer en la Dock, `0` / `Ctrl+Z`, un nuevo atajo global "Undo my last marker" en el script Lua de OBS y `POST /api/rooms/:id/markers/undo` para Stream Deck (member token).
- **Editar / borrar marcadores**: `UPDATE_MARKER` (etiqueta, comentario, categoría, color; el tiempo no cambia; una categoría nueva trae su color de DaVinci por defecto) y `DELETE_MARKER`, permitidos para la Dock del autor o el host de la sala. Se difunden como `MARKER_UPDATED` / `MARKER_DELETED`. Edición y borrado en línea en las filas de la línea de tiempo del Panel del director para el host.
- **Historial de sesiones**: `GET /api/rooms/:id/sessions` (de la más reciente a la más antigua, con número de marcadores) y una tarjeta de historial de sesiones en el Panel del director para revisar, editar y exportar sesiones pasadas.
- `docs/stream-deck.md`: guía de Stream Deck, Streamer.bot (C#), PowerShell y curl para quick-mark y deshacer.
- Tests: `markers.test.ts` y la primera batería de tests del cliente, `obs.test.ts` (101 en total).

## [1.4.0] - 2026-10-20

### Cambiado
- **Herramientas:** Vite 8 (Rolldown / Oxc) y `@vitejs/plugin-react` 6 en todo el monorepo (el cliente estaba en Vite 6 mientras Vitest usaba Vite 7), Vitest 5, TypeScript 6.0, `@types/node` 24 (coincide con el runtime Node 24), React 19.3, lucide-react 1.60 (se eliminaron los iconos de marcas: la exportación de YouTube usa `ListVideo`). Aún no se adopta TypeScript 7 porque typescript-eslint soporta `<6.1`.
- **Tailwind CSS 4** mediante `@tailwindcss/vite`: la configuración pasa a `@theme` en `index.css`, se aplican los renombres de utilidades de v3 con la herramienta oficial de actualización y se eliminan PostCSS / autoprefixer. Se comprobó la paridad visual con capturas previas a la actualización.
- **Referencias de proyecto de TypeScript:** solución `tsconfig.json` en la raíz, `tsc -b` compila shared y después server de forma incremental; nuevos scripts `typecheck`, `clean`, `check`.
- `@streamcollab/shared` expone una condición de exportación `development` (fuentes) que usan Vite, Vitest y `tsx`, y se marca como `sideEffects: false`: Zod ya no llega al navegador (JS del cliente 408 kB -> 319 kB, gzip 121 -> 96 kB).
- Los servicios del cliente exponen suscripciones `on()` en lugar de propiedades de callback mutables; los componentes de React siguen las reglas del React Compiler (sin mutar props, sin cascadas de setState en efectos, `useEffectEvent` para el manejador de atajos de OBS, sin llamadas impuras durante el render).

### Añadido
- Configuración plana de ESLint 10 (typescript-eslint 8, eslint-plugin-react-hooks 7, eslint-config-prettier) y Prettier 3 (`npm run lint`, `format`, `format:check`).
- CI en GitHub Actions: lint, comprobación de formato, typecheck, tests, build, `npm audit` de producción, build de Docker y prueba del contenedor (salud, cliente, creación de sala, apagado ordenado).

### Corregido
- La etapa de build de Docker no copiaba el `tsconfig.json` de la raíz que necesita `tsc -b`.

### Seguridad
- Tailwind 3 arrastraba dependencias de desarrollo vulnerables (`braces`, `postcss-selector-parser`); `npm audit` informa ahora de 0 vulnerabilidades.

## [1.3.0] - 2026-10-20

### Añadido
- **Servidor de producción con un único origen**: Fastify sirve el cliente compilado (`@fastify/static`) en `/`, `/dock`, `/hud` y `/dashboard` con fallback SPA para las navegaciones del navegador; los recursos con hash se cachean 30 días (`immutable`) y `index.html` siempre se revalida.
- **Despliegue con Docker**: `Dockerfile` multi-etapa (Node 24 slim, solo dependencias de producción del workspace del servidor, sin root, volumen `/data`, healthcheck) y `docker-compose.yml` con Caddy para HTTPS / WSS automáticos (`deploy/Caddyfile`). `.dockerignore` y `.gitattributes` (LF para los archivos del contenedor).
- **Configuración validada** (`src/config.ts`): cada variable de entorno se comprueba al arrancar con Zod y los valores no válidos detienen el servidor con una lista legible. Nuevas `CLIENT_DIST`, `LOG_LEVEL`, `DOMAIN`. Se carga automáticamente un `.env` en la raíz (sin pisar nunca las variables de entorno reales).
- **Apagado ordenado** con SIGTERM / SIGINT: cierra los sockets, `wal_checkpoint(TRUNCATE)`, cierra SQLite, con un tiempo límite de seguridad de 10 s.
- **Parámetro de cliente `?server=`** para ejecutar la Dock desde una página local mientras el servidor de la sala vive en una VPS (alternativa ante las restricciones "Local Network Access" de Chrome sobre `ws://127.0.0.1`).
- Cabeceras de seguridad en todas las respuestas (`X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`).
- `deploy.test.ts` (10 tests, 90 en total).

### Cambiado
- Los enlaces de invitación siempre apuntan a `/?view=…`, sea cual sea la página desde la que se copiaron.
- Se quitan de `.env.example` las entradas `OBS_WS_URL` / `OBS_WS_PASSWORD`, que no se usaban (las credenciales de OBS se quedan en cada Dock).

### Seguridad
- Usa `@fastify/static` 10.1.6, que corrige dos avisos de severidad alta presentes en ≤10.1.1 (GHSA-8pvw-jcv7-9cmj, GHSA-83w8-p2f5-377r).

## [1.2.0] - 2026-10-20

### Añadido
- **Códigos de sala y host tokens**: `POST /api/rooms` genera un código imposible de adivinar (p. ej. `KQ7P-M3XD`) y devuelve un host token una sola vez; solo se guarda su hash SHA-256. Iniciar / detener sesiones (WebSocket y REST) exige el host token.
- **Member tokens**: la primera Dock que reclama un member id recibe un member token (mensaje `JOINED`); las entradas posteriores con ese id deben presentarlo. El endpoint HTTP `quick-mark` exige `Authorization: Bearer <memberToken>`.
- **Esquemas Zod compartidos** (`schemas/` de `@streamcollab/shared`) para cada mensaje WebSocket y cada cuerpo REST: enums de categoría / color de DaVinci, formato del timecode, límites de longitud.
- Límites de peticiones: `@fastify/rate-limit` en la creación de salas (10/min) y en quick-mark (60/min); token bucket por socket para los mensajes WebSocket (ráfaga de 40, 20/s).
- `maxPayload` de 16 KB para los frames WebSocket y límite de 64 KB para los cuerpos REST.
- *Preparación de la sala* en el Panel del director: crear sala, copiar los enlaces de invitación de la Dock / HUD, copiar o pegar el host token. Ajustes de la Dock: copiar el token HTTP de marcadores.
- Nuevos mensajes del servidor `JOINED` y `ERROR`s con código (`ROOM_NOT_FOUND`, `FORBIDDEN`, `HOST_TOKEN_INVALID`, `MEMBER_TOKEN_INVALID`, `INVALID_MESSAGE`, `NOT_JOINED`, `RATE_LIMITED`), mostrados en un aviso del cliente.
- Variables de entorno `ALLOWED_ORIGIN`, `ADMIN_TOKEN`, `TRUST_PROXY`. Migración del esquema v3 (`host_token_hash`, `token_hash`).
- `security.test.ts` (18 tests, 80 en total).

### Cambiado
- **Incompatible:** entrar en una sala desconocida devuelve `ROOM_NOT_FOUND` en lugar de crearla; el cliente ya no usa `squad-1` por defecto y recuerda la última sala.
- **Incompatible:** CORS es solo del mismo origen salvo que se defina `ALLOWED_ORIGIN` (antes era `*`). `GET /api/rooms` queda oculto salvo que se configure `ADMIN_TOKEN`.
- Las acciones WebSocket usan la identidad demostrada al entrar: se ignoran `roomId` / `memberId` / `memberName` de los payloads, y los observadores HUD / dashboard no pueden crear marcadores ni actualizar estado.
- Los detalles de errores internos ya no se devuelven a los clientes WebSocket.

### Corregido
- Un id de sesión de otra sala se podía detener, exportar o listar a través de los endpoints de una sala distinta.
- Cerrar los sockets durante el apagado del servidor escribía en una base de datos ya cerrada.
- Una Dock que perdía su member token ahora continúa con un member id nuevo en lugar de quedarse bloqueada.

## [1.1.0] - 2026-10-20

### Añadido
- **Atajos globales de OBS** (`obs-scripts/streamcollab-hotkeys.lua`): cinco atajos de frontend (Kill, Squad Wipe, Clutch, Funny, Note) asignables en OBS en *Ajustes → Atajos*, que funcionan con el juego en primer plano. El script avisa a la Dock mediante la fuente `StreamCollab Signal` y el evento `InputSettingsChanged` de obs-websocket.
- **Exportaciones por POV**: `GET /api/rooms/:id/export/:format?memberId=…` reajusta cada marcador al archivo de grabación de OBS de ese streamer (nuevo `rebaseSessionForMember` compartido). El diálogo de exportación tiene un selector *Timeline* para ello.
- **Anclas de grabación**: la Dock informa de `recordStartedAt` (la hora calibrada del servidor en que empezó su archivo de OBS; se reancla tras una pausa) y del `fpsNumerator/fpsDenominator` exacto, guardados por sesión en la nueva tabla `session_members`.
- **Heartbeat WebSocket**: el servidor hace ping cada 15 s y cierra los sockets que no responden, de modo que los clientes caídos o desconectados se marcan como desconectados.
- `clientKind` (`dock` | `hud` | `dashboard`) en `JOIN_ROOM`; los overlays HUD y los dashboards entran como observadores de solo lectura.
- Suscripciones con varios oyentes `socketClient.on(event, handler)` en el cliente.
- Migraciones del esquema SQLite mediante `PRAGMA user_version` (las bases de datos v1.0.0 se actualizan in situ) y sentencias preparadas en caché.
- 15 tests nuevos (61 en total): integración WebSocket con sockets reales, heartbeat, acotado de marcas de tiempo, EDL por POV, anclas de la matriz de sincronización, migración de BD antiguas, Content-Disposition.

### Cambiado
- Los marcadores llevan la hora de la pulsación calibrada por SNTP en el cliente (`clientTimestamp`, acotada entre −10 s y +1 s respecto a la llegada) en lugar de la hora de recepción en el servidor, e incluyen `obsRecordMs` (la posición exacta en el archivo del propio autor del marcador).
- **Matriz de sincronización multicámara**: `sessionOffsetMs` es ahora el desfase real `recordStartedAt − session.startedAt` (antes repetía el desfase de reloj SNTP). Nuevos campos `aligned`, `recordStartedAt`, `clockOffsetMs`. El diálogo de exportación carga la matriz desde el servidor para incluir las anclas.
- Los campos de nombre / sala de la barra de navegación se aplican al salir del campo o con Enter, en lugar de reconectar con cada tecla.
- Los nombres de archivo exportados usan un `filename` ASCII más `filename*` según RFC 5987, sin comillas, barras ni caracteres no válidos en Windows.

### Corregido
- Entrar en una sala que no existía (p. ej. la `squad-1` por defecto en una base de datos nueva) fallaba en la clave foránea de miembros y el cliente nunca recibía `ROOM_STATE`. Ahora las salas se crean al entrar por primera vez.
- La Dock y el Browser Source del HUD de un mismo streamer (mismo member id) se sustituían mutuamente en el servidor, así que uno de los dos dejaba de recibir eventos; además, el HUD aparecía como jugador del squad.
- Los avisos del HUD nunca aparecían porque `App` sobrescribía el callback `onMarkerAdded` del HUD.
- La Dock se reconectaba a OBS cada vez que llegaba la configuración de vídeo.
- Cerrar a propósito el socket del cliente programaba una reconexión fantasma.

## [1.0.0] - 2026-10-20

*Nota: las afirmaciones de esta versión sobre avisos "a 60 FPS acelerados por GPU" ("60 FPS GPU-accelerated") y precisión "inferior al milisegundo" ("sub-millisecond") nunca se verificaron y se retiraron del README en 1.6.0.*

### Añadido

#### `@streamcollab/shared`
- **Motor de timecode SMPTE**:
  - Aritmética racional de alta precisión (`RationalTimecode`) para evitar la deriva del timecode por coma flotante en emisiones de varias horas.
  - Cálculo real de SMPTE Drop-Frame (DF) y Non-Drop-Frame (NDF) con el salto de fotogramas correcto en cada minuto para 29.97 fps y 59.94 fps.
  - Soporte completo de los framerates de la industria: 60, 59.94 (60000/1001), 50, 30, 29.97 (30000/1001), 25, 24 y 23.976 (24000/1001) fps.
  - Timecode base configurable (p. ej. `00:00:00:00` o `01:00:00:00`) con conversión en ambos sentidos entre fotogramas y timecode.
- **Exportadores para editores (NLE)**:
  - **EDL CMX 3600 para DaVinci Resolve**: genera eventos de edición de 1 fotograma con precisión de muestra (`001`, `002`...) con terminadores de línea CRLF y marcadores nativos `* LOC:` con color (Red, Fuchsia, Yellow, Cyan, Blue).
  - **XML FCP 7 (`xmeml` v4) para Adobe Premiere Pro**: formato de intercambio XML estricto de Apple con bloques de formato de vídeo `<format><samplecharacteristics>` y etiquetas `<marker>` en la pista con la categoría delante y los comentarios del autor.
  - **CSV universal RFC 4180**: exportación CSV limpia con el escapado correcto de comillas, comas y saltos de línea para Markerbox, Google Sheets y Microsoft Excel.
  - **Capítulos de YouTube**: formato limpio para la descripción (`00:00 Intro\n...`) que respeta el intervalo mínimo de 10 segundos de YouTube.
  - **Matriz de sincronización multicámara (JSON)**: calcula los desfases de calibración del reloj, la alineación de fotogramas y los desfases de inicio de sesión de todas las cámaras de los creadores del squad.
- **Contratos de datos y esquemas compartidos**:
  - Interfaces TypeScript fuertemente tipadas y payloads de eventos WebSocket (`RoomState`, `SquadMember`, `Marker`, `RecordingStatus`, `TimecodeSettings`, `SntpPayload`, `ClientToServerEvents`, `ServerToClientEvents`).

#### `@streamcollab/server`
- **Arquitectura Fastify v5**:
  - Backend REST y WebSocket de alto rendimiento con Fastify v5, `@fastify/websocket` v11 y `@fastify/cors`.
  - Gestión de salas (`RoomManager`) con difusión de mensajes, seguimiento del heartbeat de los creadores y cierre automático de salas.
- **Almacenamiento SQLite nativo de Node 24**:
  - `node:sqlite` nativo de Node 24 (`DatabaseSync`) con Write-Ahead Logging (`PRAGMA journal_mode = WAL`) y `synchronous = NORMAL` para una persistencia muy rápida y sin dependencias.
  - Esquema relacional de salas, sesiones de grabación y marcadores del squad con consultas indexadas.
- **Motor de reloj SNTP de 4 marcas de tiempo**:
  - Estimación con precisión inferior al milisegundo del tiempo de ida y vuelta (RTT) y del desfase de reloj ($\theta = \frac{(T_2 - T_1) + (T_3 - T_4)}{2}$) entre los PCs de los streamers y el servidor central, para alinear líneas de tiempo multicámara entre equipos físicos distribuidos.
- **Endpoints de la API REST**:
  - `/api/health`: sonda de disponibilidad.
  - `/api/rooms`: crear, consultar y gestionar salas colaborativas.
  - `/api/rooms/:roomId/session/start` y `/api/rooms/:roomId/session/stop`: ciclo de vida de las sesiones.
  - `/api/rooms/:roomId/quick-mark`: entrada instantánea de marcadores por HTTP.
  - `/api/rooms/:roomId/markers`: consulta del historial de marcadores.
  - `/api/rooms/:roomId/export/:format`: generación dinámica de exportaciones (`edl`, `xml`, `csv`, `youtube`, `matrix`) durante y después de las sesiones de grabación.

#### `@streamcollab/client`
- **Dock nativa para OBS Studio (`?view=dock`)**:
  - Conexión directa con OBS Studio mediante `obs-websocket-js` v5 (`ws://127.0.0.1:4455`).
  - Consulta automática de la configuración de vídeo del lienzo (`GetVideoSettings`) y de la duración de la grabación en vivo (`GetRecordStatus`).
  - Atajos (`1`..`5`) asignados a los eventos habituales del squad:
    - `1` 🎯 Kill (rojo)
    - `2` 💥 Squad Wipe (fucsia)
    - `3` 🏆 Clutch Play (amarillo)
    - `4` 😂 Funny Moment (cian)
    - `5` 📝 Timeline Note (azul)
  - Campo de comentario propio e historial de marcadores en vivo, del más reciente al más antiguo, con lectura del timecode SMPTE.
- **Overlay HUD para Browser Source de OBS Studio (`?view=hud`)**:
  - Overlay transparente (`bg-transparent`) pensado para Browser Sources de OBS de 1920x1080.
  - Avisos animados a 60 FPS acelerados por GPU, con sonido, que entran en pantalla con cada momento destacado.
  - Indicador del squad en tiempo real con el estado de grabación en vivo (🔴 REC, ⏸️ PAUSED, ⚪ IDLE) de cada miembro.
  - Gancho al evento `obsSourceVisibleChanged` de OBS para reducir automáticamente los temporizadores y detener el renderizado cuando está oculto, ahorrando GPU en partidas competitivas.
- **Dashboard del director del torneo (`?view=dashboard`)**:
  - Centro de mando para seguir el estado de grabación, los timecodes y la salud de la sincronización del reloj de todos los miembros del squad.
  - Iniciar / detener sesiones de grabación globales y lanzar exportaciones para editores con un clic.
- **Diálogo de exportación para editores**:
  - Diálogo sencillo para previsualizar y descargar el EDL de DaVinci Resolve, el XML de Premiere Pro, el CSV universal o la matriz de sincronización multicámara, o copiar los capítulos de YouTube al portapapeles.

#### Configuración y experiencia de desarrollo
- **Configuración del entorno y del build**:
  - Plantilla `.env.example` para el puerto del servidor, el host, la ruta de la base de datos y las credenciales de OBS.
  - `vitest.config.ts` propio con informes de cobertura V8 y patrones glob de los workspaces.
  - Script `npm start` en la raíz para ejecutar el servidor Fastify de producción compilado.

### Corregido
- Truncamiento a entero del SMPTE en los cálculos racionales por debajo del fotograma.
- Cálculo de la duración de la secuencia del XML FCP 7 y conformidad con la DTD con marcadores a nivel de secuencia.
- Acceso a los exportadores tras detener la sesión, para poder generar la línea de tiempo después de la emisión.
- Navegación por rutas tanto con query string (`?view=dock`) como con hash (`#/dock`).

[Unreleased]: https://github.com/Consterna/streamcollab/compare/v1.6.1...HEAD
[1.6.1]: https://github.com/Consterna/streamcollab/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/Consterna/streamcollab/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/Consterna/streamcollab/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Consterna/streamcollab/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Consterna/streamcollab/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Consterna/streamcollab/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Consterna/streamcollab/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Consterna/streamcollab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Consterna/streamcollab/releases/tag/v1.0.0
