[English](README.md) | **Español**

# 🎮 StreamCollab — Marcadores de squad para OBS y HUD multicámara en directo

[![CI](https://github.com/Consterna/streamcollab/actions/workflows/ci.yml/badge.svg)](https://github.com/Consterna/streamcollab/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Última versión](https://img.shields.io/github/v/release/Consterna/streamcollab)](https://github.com/Consterna/streamcollab/releases/latest)

> **Marcadores colaborativos de alta precisión y sincronización multicámara para OBS Studio y editores profesionales (DaVinci Resolve, Adobe Premiere Pro, YouTube).**

StreamCollab permite que squads de juego competitivo, grupos de creadores y directores de torneos de esports coordinen sus grabaciones multicámara en tiempo real. Cada creador marca al instante kills épicas, squad wipes, clutches y momentos graciosos con un atajo de teclado o un clic, desde el propio OBS Studio. Al terminar la sesión, StreamCollab genera **marcadores de línea de tiempo con timecode SMPTE y matrices de sincronización multicámara** listos para el editor de vídeo.

---

## 🚀 Funciones principales

- **Dock nativa para OBS Studio (Custom Browser Dock)**:
  - Se conecta directamente al OBS Studio local mediante `obs-websocket-js` v5 (`ws://127.0.0.1:4455`).
  - Lee la configuración de vídeo de OBS (`GetVideoSettings`: framerate, resolución base y de salida) y el estado de la grabación (`GetRecordStatus`: duración en vivo, grabando o en pausa).
  - Atajos rápidos:
    - `1` 🎯 **Kill** (marcador rojo)
    - `2` 💥 **Squad Wipe** (marcador fucsia)
    - `3` 🏆 **Clutch** (marcador amarillo)
    - `4` 😂 **Momento gracioso** (marcador cian)
    - `5` 📝 **Nota** (marcador azul)
  - **Atajos globales mientras juegas** con el script Lua para OBS incluido (`streamcollab-hotkeys.lua`), asignables en OBS en *Ajustes → Atajos*.
  - Campo de texto para una etiqueta o un comentario propios.
  - **Deshacer** tu último marcador con el botón Deshacer, `0` / `Ctrl+Z` o un atajo global de OBS.
  - **Capítulos nativos de OBS**: cada marcador se escribe también como capítulo en tu propia grabación (OBS 30.2+, Hybrid MP4), y opcionalmente también los de tus compañeros.
  - Historial de marcadores en vivo, del más reciente al más antiguo, con timecode SMPTE.
  - Muestra **Servidor desconectado** mientras no llega al servidor de StreamCollab y te avisa cuando un marcador no se pudo enviar.

- **HUD para Browser Source de OBS (overlay transparente)**:
  - Overlay transparente (`bg-transparent`) pensado para las fuentes de navegador de OBS Studio.
  - Avisos animados con CSS que entran en pantalla cuando cualquier compañero marca un momento.
  - Sonidos de aviso opcionales por categoría (`&sound=1&volume=0.6` en el enlace del HUD), sintetizados en la propia página, sin archivos de audio.
  - En la lista del squad en pantalla solo aparecen los compañeros con la Dock conectada.
  - Indicador del squad en tiempo real con el estado de grabación de OBS de cada creador (🔴 REC, ⏸️ PAUSA, ⚪ INACTIVO).
  - **Ahorro de recursos**: escucha el evento `obsSourceVisibleChanged` de OBS y deja de renderizar y de contar los avisos mientras la fuente o la escena están ocultas. El intervalo del limpiador de avisos preserva la identidad de referencia cuando no caducan avisos, eliminando re-renderizados innecesarios en OBS CEF.

- **Motor de timecode SMPTE de alta precisión**:
  - Aritmética racional pura, sin la deriva de la coma flotante en emisiones de varias horas.
  - Todos los framerates estándar: `60 fps`, `59.94 fps` (60000/1001), `50 fps`, `30 fps`, `29.97 fps` (30000/1001), `25 fps`, `24 fps` y `23.976 fps` (24000/1001).
  - Cálculo real de SMPTE Drop Frame (DF) y Non-Drop Frame (NDF), con el salto de fotogramas correcto en cada minuto (el drop frame solo existe a 29.97 y 59.94 fps).
  - Timecode base configurable (p. ej. `01:00:00:00` o `00:00:00:00`).

- **Exportadores para editores (NLE)**:
  - 🎬 **EDL CMX 3600 para DaVinci Resolve**: saltos de línea CRLF estrictos, eventos de edición de 1 fotograma numerados (`001`, `002`...) y localizadores `* LOC:` con los colores nativos de marcador de DaVinci (Red, Fuchsia, Yellow, Cyan, Blue, Green), acotados contra duraciones negativas de fotogramas.
  - 🎞️ **XML FCP 7 (`xmeml` v4) para Adobe Premiere Pro**: XML de Final Cut Pro 7 válido con eliminación de caracteres de control, con bloques `<format><samplecharacteristics>` completos y etiquetas `<marker>` en la pista con el identificador de la categoría delante.
  - 📊 **CSV universal**: CSV conforme a RFC 4180, compatible con Google Sheets, Microsoft Excel y Markerbox. Patrones de inyección de fórmulas (`/^\s*[=+\-@|]|[\t\r]/`) neutralizados de forma segura.
  - 📺 **Capítulos de YouTube**: formato limpio para la descripción (`00:00 Intro\n01:23 First Blood`) que siempre empieza en `00:00` y respeta la duración mínima de 10 segundos por capítulo de YouTube.
  - 🛰️ **Matriz de sincronización multicámara (JSON)**: dónde empieza el archivo de OBS de cada creador respecto a la sesión (en ms y fotogramas), a partir de anclas de grabación calibradas con SNTP.
  - 🎥 **Líneas de tiempo por POV**: cualquier formato se puede exportar reajustado a la grabación de un creador concreto (`?memberId=`), para que los marcadores caigan en el fotograma correcto de ese clip.

- **Salas privadas y control del host**:
  - Las salas se crean de forma explícita y se identifican con un código imposible de adivinar (p. ej. `KQ7P-M3XD`).
  - Solo el host (quien tiene el host token de la sala) puede iniciar o detener sesiones; la Dock de cada streamer queda ligada a su propio member token, así que nadie puede marcar ni cambiar el estado en nombre de otro.
  - Una misma Dock puede ser miembro de varias salas a la vez.
  - Cada mensaje WebSocket y cada cuerpo REST se valida con esquemas Zod compartidos; hay límites de peticiones por socket y por ruta.

- **Backend Fastify de alta concurrencia y SQLite en modo WAL**:
  - Fastify v5 con `@fastify/websocket` v11 y `@fastify/cors`.
  - `node:sqlite` nativo de Node 24 (`DatabaseSync`) con Write-Ahead Logging (`PRAGMA journal_mode = WAL`), `busy_timeout = 5000ms`, transacciones atómicas y recuperación automática de sesiones huérfanas tras caída en el arranque.
  - **Motor SNTP de 4 marcas de tiempo**: calibración continua del RTT y del desfase de reloj con ráfaga inicial de 4 pings, descarte de picos de jitter (> 2.5x línea base) y suavizado exponencial cada 5s ($\theta = \frac{(T_2 - T_1) + (T_3 - T_4)}{2}$) entre los PCs de los streamers y el servidor.

---

### Idiomas
La interfaz está disponible en **español e inglés**. Sigue el idioma del navegador, se puede cambiar con el selector de la barra de navegación y se puede fijar por enlace con `&lang=es` / `&lang=en`. Los enlaces de invitación copiados desde el Panel del director conservan el idioma del panel, así que las Docks y los overlays que pegues en OBS salen en ese mismo idioma. Las etiquetas por defecto de los marcadores (p. ej. "Kill confirmada" / "Kill Confirmed") usan el idioma del streamer que marca.

---

## ⚡ Inicio rápido

StreamCollab es un único servidor: sirve el Panel del director, la Dock, el HUD, la API REST y el hub WebSocket desde una sola dirección. Se pone en marcha una vez para todo el squad y luego cada streamer añade la Dock y el HUD a su OBS ([Configurar OBS Studio](#-configurar-obs-studio)).

Hay imágenes ya compiladas para `linux/amd64` y `linux/arm64` en `ghcr.io/consterna/streamcollab`.

### Opción A: un PC o tu red local (Docker)
Con [Docker](https://docs.docker.com/get-started/get-docker/) instalado:
```bash
docker run -d -p 3000:3000 -v streamcollab-data:/data --name streamcollab ghcr.io/consterna/streamcollab:1.6.1
```
1. Abre `http://localhost:3000/dashboard` y crea una sala (**Nueva sala** → **Crear**). A partir de ahí eres su host.
2. Copia los enlaces de la Dock y del HUD desde el Panel del director y pégalos en OBS.
3. Para compañeros en otros PCs de la misma red: abre el Panel del director en `http://<IP local de este PC>:3000/dashboard`, así los enlaces copiados apuntan a una dirección a la que ellos llegan, y permite el puerto 3000 en el firewall de este PC.

La base de datos vive en el volumen `streamcollab-data` y sobrevive a las actualizaciones del contenedor. Para actualizar, borra el contenedor y vuelve a ejecutar el mismo comando con la etiqueta de la nueva versión: `docker rm -f streamcollab` y luego `docker run ...:<nueva versión>`.

Esta opción usa HTTP sin cifrar y está pensada para la red de casa. Para jugar con compañeros a través de internet, usa la opción B.

### Opción B: VPS con HTTPS (Docker Compose + Caddy)
`docker-compose.yml` ejecuta la imagen publicada detrás de [Caddy](https://caddyserver.com), que obtiene y renueva el certificado TLS automáticamente (HTTPS y WSS).

1. Apunta un registro DNS (p. ej. `collab.example.com`) a la VPS y abre los puertos 80 y 443.
2. En la VPS:
   ```bash
   git clone https://github.com/Consterna/streamcollab.git && cd streamcollab
   cp .env.example .env    # pon DOMAIN=collab.example.com (y ADMIN_TOKEN si quieres la lista de salas)
   docker compose pull && docker compose up -d
   ```
   Así se usa `ghcr.io/consterna/streamcollab:1.6.1`; define `STREAMCOLLAB_TAG` en `.env` para elegir otra versión publicada. Si prefieres compilar la imagen desde el código que has clonado, ejecuta `docker compose up -d --build`.
3. Abre `https://collab.example.com/dashboard`, crea una sala y comparte los enlaces de la Dock y del HUD.

Copias de seguridad, actualizaciones y logs: [En una VPS](#-en-una-vps).

### Sin Docker
Instala Node.js 24 y ejecuta el servidor desde el código fuente: consulta [Servidor de producción desde el código](#servidor-de-producción-desde-el-código).

---

## 🎥 Configurar OBS Studio

Los enlaces de ejemplo usan `http://localhost:3000` (opción A). En una VPS, usa tu dominio, p. ej. `https://collab.example.com/?view=dock&room=KQ7P-M3XD`. Los botones de copiar del Panel del director siempre te dan el enlace correcto.

Los botones de StreamCollab se nombran aquí como en la interfaz en español; si la ves en inglés, cambia el idioma en la barra de navegación o añade `&lang=es` al enlace.

### 1. Activar el servidor WebSocket de OBS
1. En OBS Studio, abre **Herramientas** → **Configuración del servidor WebSocket**.
2. Marca **Habilitar servidor WebSocket**.
3. Puerto del servidor: `4455` (por defecto).
4. Si activas la autenticación, apunta la contraseña (la escribirás en los ajustes de la Dock de StreamCollab).
5. Pulsa **Aplicar** → **Aceptar**.

### 2. Añadir la Dock personalizada de navegador
1. En el menú superior de OBS Studio, pulsa **Docks** → **Docks personalizados del navegador...**
2. **Nombre del dock**: `StreamCollab Squad Marker`
3. **URL**: el enlace de la Dock del Panel del director, p. ej. `http://localhost:3000/?view=dock&room=KQ7P-M3XD`
4. Pulsa **Aplicar**.
5. La Dock se abre como una ventana dentro de OBS Studio. Arrástrala a tu espacio de trabajo (p. ej. junto al mezclador de audio o a la lista de escenas).
6. Pulsa **OBS desconectado** → comprueba `ws://127.0.0.1:4455` (y la contraseña, si activaste la autenticación) → pulsa **Conectar**. La dirección y la contraseña se guardan en este perfil de OBS, y la Dock se reconecta sola cada vez que OBS (o su servidor WebSocket) se reinicia.
7. El estado pasa a un punto verde **OBS conectado**, con la resolución del lienzo, el framerate y el estado de la grabación.

La dirección y la contraseña del WebSocket de OBS se guardan en texto plano en el almacenamiento del navegador de la Dock (`localStorage`), dentro de este perfil de OBS. Nunca se envían al servidor de StreamCollab.

Si la Dock se queda en **OBS desconectado** con OBS abierto, consulta [Si la Dock no conecta con OBS](#si-la-dock-no-conecta-con-obs).

### 3. Atajos globales mientras juegas (recomendado)
Las teclas `1`..`5` de la Dock solo funcionan cuando la Dock tiene el foco. Para marcar desde dentro del juego:
1. Descarga `streamcollab-hotkeys.lua` de los archivos adjuntos de la [última versión](https://github.com/Consterna/streamcollab/releases/latest) (su SHA-256 aparece en `SHA256SUMS`) o toma [`obs-scripts/streamcollab-hotkeys.lua`](obs-scripts/streamcollab-hotkeys.lua) de este repositorio.
2. En OBS Studio, abre **Herramientas** → **Scripts** → **+** y elige el archivo.
3. Abre **Ajustes** → **Atajos**, busca `StreamCollab` y asigna *Kill*, *Squad Wipe*, *Clutch Play*, *Funny Moment*, *Timeline Note* y *Undo my last marker* (el script registra los nombres en inglés).
4. Deja la Dock de StreamCollab abierta y conectada a OBS. Cada pulsación actualiza la fuente oculta `StreamCollab Signal`; la Dock la recibe por obs-websocket y crea el marcador.

El script crea la fuente `StreamCollab Signal` automáticamente. Nunca se añade a una escena, así que no se renderiza nada.

**Capítulos nativos en tu grabación (opcional):** con OBS 30.2+, pon **Ajustes** → **Salida** → **Grabación** → **Formato de grabación** en **Hybrid MP4**. La Dock escribirá entonces cada marcador como capítulo en el archivo que estás grabando, así el editor los ve sin necesidad de importar un EDL. El panel de ajustes de la Dock muestra si los capítulos están disponibles y permite añadir también los marcadores de tus compañeros. Los capítulos quedan en el archivo para siempre: deshacer un marcador en StreamCollab no borra su capítulo.

### 4. Añadir la fuente de navegador (overlay HUD)
1. En tu escena de OBS, pulsa **Añadir fuente (+)** → **Navegador**.
2. Llámala `StreamCollab HUD`.
3. Configúrala:
   - **URL**: el enlace del HUD del Panel del director, p. ej. `http://localhost:3000/?view=hud&room=KQ7P-M3XD`
   - **Ancho**: `1920`
   - **Alto**: `1080`
   - **CSS personalizado**: déjalo como está o vacíalo; el fondo ya es transparente.
   - Casilla de apagar la fuente cuando no es visible (*Shutdown source when not visible*): marcada (opcional; el detector de visibilidad integrado ya se encarga).
4. Pulsa **Aceptar**.
5. Cuando cualquier compañero pulsa un atajo (`1`..`5`) o marca un momento, entra en pantalla un aviso con la categoría, la etiqueta, el creador y el timecode SMPTE.
6. **Sonido (opcional):** usa el enlace *HUD con sonido* del Panel del director (añade `&sound=1&volume=0.6`). Marca la casilla de controlar el audio mediante OBS (*Control audio via OBS*) en las propiedades de la fuente para que los avisos tengan su propio fader en el mezclador.

### 5. Panel del director
- Desde cualquier navegador: `http://localhost:3000/dashboard` (o `/?view=dashboard`).
- Crea la sala (pasas a ser su host) y copia los enlaces de invitación de la Dock y del HUD.
- Consulta el **Historial de sesiones**: elige cualquier sesión pasada para revisar, corregir y exportar sus marcadores.
- Inicia sesiones de grabación maestras, ajusta el timecode base y el framerate (60, 59.94, 50, 30, 29.97, 25, 24 y 23.976 fps; drop frame a 29.97 y 59.94), sigue la duración de grabación y la calibración del reloj de todo el squad y exporta líneas de tiempo para el editor con un clic.

---

## 🔐 Salas, hosts y seguridad

1. **El host crea la sala** en el Panel del director (`/dashboard`) → **Nueva sala** → **Crear**. El servidor devuelve un código de sala y un **host token**; el token se guarda en ese navegador y en el servidor solo queda su hash SHA-256.
2. **Invita al squad** con los botones de copiar: la URL de la Dock (`/?view=dock&room=<CÓDIGO>`) y la del HUD (`/?view=hud&room=<CÓDIGO>`). El código de sala es la invitación, así que compártelo solo con tu squad.
3. **Llevar el control de host a otro dispositivo**: copia el host token desde *Eres el host* y pégalo en *Solo lectura → Desbloquear* en el otro dispositivo.
4. **Identidad del streamer**: la primera vez que una Dock entra, el servidor emite un member token ligado al member id de esa Dock (guardado en el perfil de navegador de OBS). La misma identidad sirve en todas las salas a las que entre esa Dock. Si la Dock lo pierde, vuelve a entrar automáticamente con un member id nuevo.

| Acción | Quién puede hacerla |
| --- | --- |
| Ver la sala, los marcadores y las exportaciones | Cualquiera con el código de sala |
| Crear marcadores, actualizar el estado de OBS | La Dock del propio streamer (member token) |
| Iniciar / detener sesiones | El host (host token); ver *Auto Session* más abajo |
| Borrar sesiones terminadas, borrar la sala, quitar miembros desconectados | El host (host token) |
| Listar todas las salas (`GET /api/rooms`) | Solo el administrador (`ADMIN_TOKEN`); oculto en otro caso |

**Auto Session:** si un streamer marca (desde la Dock, un atajo o el quick-mark HTTP) sin ninguna sesión en marcha, el servidor inicia una automáticamente, llamada `Auto Session` seguido de la hora local del servidor (60 fps, non-drop frame, timecode base `01:00:00:00`). Es decir, una sesión puede empezar sin el host, pero solo el host puede detenerla. Iniciar una sesión nueva siempre detiene la que estuviera en marcha.

**Quick-mark y deshacer por HTTP (Stream Deck / Streamer.bot):** en la Dock, abre el panel de ajustes de OBS y copia el *Token HTTP*; después:
```http
POST /api/rooms/<CÓDIGO>/quick-mark
Authorization: Bearer <member token>
Content-Type: application/json

{ "memberId": "<tu member id>", "category": "kill", "label": "Ace" }
```
`POST /api/rooms/<CÓDIGO>/markers/undo` con `{ "memberId": "..." }` borra tu último marcador. Guía paso a paso para Stream Deck, Streamer.bot, PowerShell y curl: [docs/stream-deck.es.md](docs/stream-deck.es.md).

**Editar marcadores:** el autor (desde su propia Dock) y el host pueden corregir o borrar marcadores; el Panel del director muestra al host los botones de editar y borrar en cada fila de la línea de tiempo. Las ediciones conservan el tiempo original y se reflejan en todas las exportaciones.

**Variables de entorno del servidor** (ver `.env.example`):
- `ALLOWED_ORIGIN`: orígenes, separados por comas, que pueden llamar a la API REST desde otro origen. Déjala vacía si el cliente se sirve desde el mismo servidor (por defecto).
- `ADMIN_TOKEN`: habilita `GET /api/rooms` con `Authorization: Bearer <ADMIN_TOKEN>` (16 caracteres o más).
- `TRUST_PROXY`: `true` detrás de un proxy inverso, para que los límites de peticiones usen la IP real del cliente. Actívala solo detrás de un proxy que **sobrescriba** `X-Forwarded-For` con la dirección que ve. Caddy lo hace por defecto (`docker-compose.yml` ya pone `TRUST_PROXY=true` para él). Con otro proxy, configúralo así (en Nginx, `proxy_set_header X-Forwarded-For $remote_addr;`); si no, un cliente puede enviar una IP falsa y saltarse los límites.
- `ROOM_CREATE_LIMIT_PER_MINUTE`: salas que una IP puede crear por minuto (10 por defecto).

Los códigos de sala se aceptan en mayúsculas o minúsculas (`kq7p-m3xd` entra en `KQ7P-M3XD`). Una IP que prueba más de 20 códigos de sala inexistentes en un minuto queda bloqueada el resto de ese minuto.

Las salas creadas con v1.0/v1.1 no tienen host token: se pueden ver y se puede marcar en ellas, pero no iniciar ni detener sesiones. Crea una sala nueva.

Para informar de una vulnerabilidad, consulta [SECURITY.md](SECURITY.md).

---

## 🚢 En una VPS

El repositorio incluye un `Dockerfile` multi-etapa (Node 24, solo dependencias de producción, usuario sin privilegios, healthcheck en `/api/health`) y el `docker-compose.yml` de la [opción B](#opción-b-vps-con-https-docker-compose--caddy).

- **Datos**: SQLite vive en el volumen `streamcollab-data` (`/data/streamcollab.sqlite`). Haz la copia **en caliente** (una instantánea coherente y compactada con `VACUUM INTO` de SQLite, verificada con `integrity_check`) y sácala del contenedor:
  ```bash
  docker compose exec streamcollab node packages/server/dist/backup.js /data/backups/streamcollab.sqlite
  docker compose cp streamcollab:/data/backups/streamcollab.sqlite ./streamcollab-backup.sqlite
  ```
  Con el contenedor único de la opción A, usa `docker exec streamcollab ...` y `docker cp streamcollab:/data/backups/streamcollab.sqlite .`. Desde el código fuente: `npm run backup` escribe `backups/streamcollab-<fecha>.sqlite` junto a la base de datos (o `npm run backup -- <archivo>`). Nunca sobrescribe archivos existentes. Para restaurar, detén el servidor y pon la copia en lugar del archivo de la base de datos.
- **Actualizaciones**: `git pull && docker compose pull && docker compose up -d` (o `git pull && docker compose up -d --build` si compilas desde el código). Las migraciones del esquema se aplican solas al arrancar.
- **Apagado**: `docker compose stop` envía SIGTERM; el servidor cierra los sockets, hace checkpoint del WAL de SQLite y sale (15 s de margen).
- **Logs**: `docker compose logs -f streamcollab` (`LOG_LEVEL` controla el detalle).

### Si la Dock no conecta con OBS
La Dock habla con OBS en `ws://127.0.0.1:4455` desde tu PC. Las versiones recientes de Chromium restringen que las páginas HTTPS públicas abran conexiones a `localhost` ("Local Network Access"), y una Dock personalizada de OBS puede no ser capaz de mostrar la petición de permiso.

**OBS 33** (en fase de release candidate al escribir esto) actualiza el Chromium (CEF) integrado en OBS de la versión 127 a la 150 ([notas de la 33.0.0-rc3](https://github.com/obsproject/obs-studio/releases/tag/33.0.0-rc3)). Sus betas bloquearon las peticiones de páginas públicas a `localhost` ([obsproject/obs-browser#545](https://github.com/obsproject/obs-browser/issues/545)); OBS las restableció con un cambio que describe como temporal ([obsproject/obs-studio#14009](https://github.com/obsproject/obs-studio/pull/14009)).

Si la Dock cargada desde tu dominio se queda en **OBS desconectado**:
1. Sirve la Dock en local, junto a OBS: por ejemplo `npm run build` y después `npm run preview --workspace=packages/client`, que sirve `http://localhost:4173` (o ejecuta la imagen Docker de la opción A en ese PC y usa `http://localhost:3000`).
2. Usa la URL de la Dock con el parámetro `server`, para que siga entrando en la sala de tu VPS:
   `http://localhost:4173/?view=dock&room=<CÓDIGO>&server=https://collab.example.com`
3. Añade ese origen local a `ALLOWED_ORIGIN` en el servidor (p. ej. `ALLOWED_ORIGIN=http://localhost:4173`).

El HUD y el Panel del director nunca hablan con el WebSocket de OBS, así que siempre se pueden cargar desde el dominio público.

---

## 🎬 Importar los marcadores en el editor

### DaVinci Resolve
1. En la Dock o en el Panel del director, pulsa **Exportar NLE** → elige **DaVinci Resolve**.
2. Pulsa **Descargar archivo** (`.edl`).
3. En DaVinci Resolve:
   - Ve a **File** → **Import** → **Timeline...** (o clic derecho en la línea de tiempo → **Timelines** → **Import** → **EDL/XML...**).
   - Elige el archivo `.edl` descargado.
   - DaVinci Resolve crea marcadores en la línea de tiempo con el color nativo de cada tipo de evento (rojo para kills, fucsia para wipes, amarillo para clutches, cian para momentos graciosos, azul para notas).

Los títulos del EDL son ASCII puro: las letras acentuadas se simplifican (una sesión llamada "Sesión" pasa a "Sesion").

### Adobe Premiere Pro
1. Pulsa **Exportar NLE** → elige **Premiere Pro**.
2. Pulsa **Descargar archivo** (`.xml`).
3. En Adobe Premiere Pro:
   - Ve a **Archivo** → **Importar...** (`Ctrl + I` / `Cmd + I`).
   - Elige la secuencia `.xml`.
   - Premiere Pro abre una secuencia con todos los marcadores del squad en la pista de vídeo, con la categoría delante y los comentarios del autor.

### Líneas de tiempo por creador (POV)
La Dock de cada creador informa de cuándo empezó su archivo de grabación de OBS (con el reloj calibrado del servidor). En el diálogo **Exportar NLE**, elige un creador en el selector **Línea de tiempo** para obtener los marcadores reajustados a la grabación de ese creador:
- Los marcadores de ese creador usan la posición exacta dentro del archivo que informó OBS.
- Los de sus compañeros se colocan con el reloj calibrado por SNTP.
- REST: `GET /api/rooms/:roomId/export/:format?sessionId=…&memberId=…`

Una exportación POV necesita que el OBS de ese creador estuviera grabando durante la sesión.

Limitación conocida: si un creador pausa la grabación, los marcadores de sus compañeros hechos *antes* de la pausa pueden desplazarse en la exportación POV de ese creador (los suyos propios siguen siendo exactos).

### Capítulos de YouTube
1. Pulsa **Exportar NLE** → elige **Capítulos de YouTube**.
2. Pulsa **Copiar código**.
3. Pégalo directamente en la descripción de tu vídeo de YouTube.

YouTube solo muestra los capítulos si el primero empieza en `00:00`, hay al menos 3 marcas de tiempo y cada capítulo dura 10 segundos o más. El exportador siempre empieza en `00:00` y respeta el mínimo de 10 segundos; el diálogo te avisa cuando una exportación tiene menos de 3 capítulos.

La línea de tiempo **Sesión principal** cuenta desde el inicio de la sesión de StreamCollab, no desde el inicio de tu vídeo. Para los capítulos de tu propio vídeo, elige tu nombre en el selector **Línea de tiempo** (exportación POV): los tiempos pasan a ser relativos a tu archivo de grabación de OBS.

---

## 🛠️ Desarrollo

### Requisitos
- **Node.js**: v24 LTS (o superior), con soporte nativo de `node:sqlite`
- **npm**: v11+
- **OBS Studio**: v28+ (WebSocket v5 viene integrado en OBS Studio)

> En Windows PowerShell, usa `npm.cmd` (y `npx.cmd`) si la ejecución de scripts está bloqueada.

### 1. Instalar dependencias y preparar el entorno
```bash
git clone https://github.com/Consterna/streamcollab.git && cd streamcollab
npm install

# Opcional: cambiar el puerto, el host o la ruta de la base de datos SQLite
cp .env.example .env
```

### 2. Compilar todos los workspaces
```bash
npm run build
```

### 3. Ejecutar los tests
```bash
npm test
```
Más de 100 tests unitarios y de integración comprueban los límites del drop frame SMPTE, el formato XML/EDL para editores, el escapado del CSV y las rutas de Fastify con SQLite en modo WAL.

### Flujo de trabajo
| Comando | Qué hace |
| --- | --- |
| `npm run check` | Lint, comprobación de formato, typecheck y tests unitarios / de integración |
| `npm run e2e` | Tests end-to-end con Playwright contra el servidor compilado (ejecuta antes `build`) |
| `npm run lint` | ESLint 10 (TypeScript + reglas de React hooks / React Compiler) |
| `npm run format` | Prettier (`format:check` para solo comprobar) |
| `npm run typecheck` | `tsc -b` (shared, server) + `tsc --noEmit` del cliente |
| `npm run build` | `tsc -b` incremental + build de producción de Vite del cliente |
| `npm run clean` | Borra las salidas de `tsc -b` |
| `npm run backup` | Copia en caliente de la base de datos SQLite (`-- <archivo>` para elegir el destino) |

En desarrollo, `@streamcollab/shared` se resuelve desde sus fuentes TypeScript mediante la condición de exportación `development` (Vite, Vitest y `tsx --conditions=development`), así que nunca hace falta recompilarlo mientras trabajas. Producción y Docker usan el `dist` compilado.

GitHub Actions (`.github/workflows/ci.yml`) ejecuta las mismas comprobaciones más `npm audit` sobre las dependencias de producción, y después construye la imagen Docker y la prueba (salud, cliente, creación de sala, código de salida del apagado ordenado).

Las contribuciones son bienvenidas: consulta [CONTRIBUTING.md](CONTRIBUTING.md).

### 4. Arrancar los servidores de desarrollo
En dos terminales:

**Terminal 1 (servidor backend):**
```bash
npm run dev:server
# Servidor de API y WebSocket en el puerto 3000
```

**Terminal 2 (cliente frontend):**
```bash
npm run dev:client
# Cliente Vite en http://localhost:5173 (redirige /api y /ws al puerto 3000)
```

En desarrollo, abre `http://localhost:5173/?view=dashboard`; los enlaces de la Dock y del HUD que copies desde ahí apuntan al puerto 5173.

### Servidor de producción desde el código
```bash
# Compila una vez y ejecuta el servidor compilado: sirve la API, el hub WebSocket
# y el cliente compilado desde un único origen (http://localhost:3000)
npm run build
npm start
```
El servidor lee el archivo `.env` de la raíz del repositorio si existe, valida todas las variables al arrancar y se detiene con un mensaje claro si algo está mal.

### 📂 Arquitectura del monorepo

```text
streamcollab/
├── packages/
│   ├── shared/            # Lógica compartida en TypeScript puro
│   │   ├── src/
│   │   │   ├── timecode/  # Calculadora SMPTE con aritmética racional y drop frame
│   │   │   ├── exporters/ # EDL, XML, CSV, capítulos de YouTube, matriz multicámara
│   │   │   ├── schemas/   # Esquemas Zod de cada mensaje WebSocket y cuerpo REST
│   │   │   └── types/     # Tipos TS compartidos y payloads de mensajes WebSocket
│   │   └── test/          # Tests de timecode, exportadores y casos límite
│   │
│   ├── server/            # Backend WebSocket y REST con Fastify v5
│   │   ├── src/
│   │   │   ├── db/        # node:sqlite nativo de Node 24 (DatabaseSync en modo WAL)
│   │   │   ├── sntp/      # Motor de reloj SNTP de 4 marcas (RTT y desfase)
│   │   │   ├── rooms/     # RoomManager y difusión a varios clientes
│   │   │   ├── routes/    # Endpoints REST (/api/rooms, /api/export, etc.)
│   │   │   └── websocket/ # Sincronización de estado en tiempo real
│   │   └── test/          # Tests de integración del servidor, la BD y los exportadores
│   │
│   └── client/            # Frontend con Vite 8 + React 19 + Tailwind CSS 4
│       └── src/
│           ├── services/  # Envoltorio de obs-websocket-js v5 y cliente de socket
│           ├── components/# Diálogo de exportación y componentes de la interfaz
│           ├── i18n/      # Diccionarios de español e inglés
│           ├── index.css  # Entrada de Tailwind CSS 4 y tema (@theme)
│           └── views/
│               ├── DockView.tsx      # Dock personalizada de OBS
│               ├── HudView.tsx       # Overlay transparente para Browser Source
│               └── DashboardView.tsx # Centro de mando del director
│
├── obs-scripts/
│   └── streamcollab-hotkeys.lua  # Atajos globales de OBS → Dock (vía obs-websocket)
│
├── docs/                  # Guía de Stream Deck y lista de pruebas con OBS real (inglés / español)
├── e2e/                   # Tests end-to-end con Playwright
├── deploy/Caddyfile       # Proxy inverso HTTPS para docker-compose
├── Dockerfile             # Imagen de producción multi-etapa
├── docker-compose.yml     # App + Caddy (HTTPS / WSS automáticos)
├── .github/workflows/ci.yml  # Lint, formato, typecheck, tests, build, prueba de la imagen Docker
├── .env.example           # Plantilla de variables de entorno
├── package.json           # Configuración del monorepo con npm workspaces
├── tsconfig.json          # Solución: `tsc -b` compila shared -> server
├── tsconfig.base.json
├── eslint.config.mjs      # Configuración plana de ESLint 10 (typescript-eslint, react-hooks)
├── .prettierrc.json
├── playwright.config.ts
└── vitest.config.ts
```

### 🧪 Tests y verificación

StreamCollab mantiene una suite de pruebas automatizada de **216 tests** (201 tests unitarios y de integración con Vitest en 23 suites + 15 tests end-to-end con Playwright simulando flujos reales multi-streamer):
```bash
npm test       # 201 tests en Vitest en 23 suites
npm run e2e    # 15 tests E2E con Playwright (flujo real multi-ventana en Chromium)
```
- `packages/shared/test/timecode.test.ts`: aritmética SMPTE, 60 fps NDF, 29.97 DF, 59.94 DF, 24 fps, salto de fotogramas en cada minuto.
- `packages/shared/test/timecode-proptest.test.ts`: tests basados en propiedades (`fast-check`) verificando biyectividad en los 8 framerates estándar, límites de minutos drop-frame, precisión submilisegundo y desbordamiento 24h.
- `packages/shared/test/exporters.test.ts`: formato del EDL CMX 3600 de DaVinci, XML FCP 7, CSV RFC 4180, capítulos de YouTube y matriz de sincronización multicámara.
- `packages/shared/test/exporters-conformance.test.ts`: conformidad estricta CRLF en EDL, análisis XML 1.0 mediante DOMParser, saneamiento de caracteres de control y fuzzing de fórmulas CSV.
- `packages/shared/test/edge-cases.test.ts`: cero marcadores, escapado XML/CSV, agrupación de capítulos de YouTube a 10 s, timecodes de más de 24 h.
- `packages/shared/test/perMember.test.ts`: reajuste de líneas de tiempo por POV y localizadores EDL sobre el archivo del propio creador.
- `packages/shared/test/regressions.test.ts`: capítulos de YouTube que empiezan en 00:00, neutralización de fórmulas en el CSV, acentos en los títulos EDL, drop frame solo a 29.97 / 59.94, validación de framerates.
- `packages/server/test/server.test.ts`: rutas de Fastify, `node:sqlite` nativo de Node 24 en modo WAL, motor SNTP de 4 marcas (desfase de reloj y RTT).
- `packages/server/test/db-concurrency.test.ts`: 20 workers concurrentes ejecutando 2.000 escrituras/s con copia de seguridad en caliente simultánea en contención WAL.
- `packages/server/test/crash-recovery.test.ts`: conciliación en el arranque de sesiones no detenidas tras caída inesperada o reinicio del servidor.
- `packages/server/test/markers.test.ts`: permisos y difusión al editar / borrar marcadores, deshacer (WebSocket y HTTP), historial de sesiones.
- `packages/server/test/audit.test.ts`: códigos de sala sin distinguir mayúsculas, presencia y retirada de miembros, borrado de sesiones / salas, límite por IP de códigos inexistentes.
- `packages/server/test/backup.test.ts`: copias en caliente de una base de datos en uso (incluidas las escrituras en el WAL), sin sobrescribir archivos existentes.
- `packages/server/test/deploy.test.ts`: validación del entorno, servicio del cliente compilado (fallback SPA, cabeceras de caché, sin path traversal), cabeceras de seguridad, modo solo API.
- `packages/server/test/security.test.ts`: host / member tokens, intentos de suplantación, acceso entre salas, errores de validación Zod, CORS, límites REST y WebSocket, frames demasiado grandes.
- `packages/server/test/ws.test.ts`: salas WebSocket con sockets reales (Dock + HUD con el mismo member id), heartbeat, marcas de tiempo calibradas, anclas de grabación, exportaciones POV y migración in situ de bases de datos v1.0.0.
- `packages/server/test/ws-chaos.test.ts`: saturación por ráfagas, tormentas de reconexión con 30 sockets, cargas de 16KB/40KB, fuzzing de JSON malformado y timeout de socket no unido (15s).
- `packages/server/test/regressions.test.ts`: pertenencia a varias salas, una sola sesión en marcha por sala, estado de la sala entre sesiones, framerates no soportados, migración del esquema v3 → v4.
- `packages/client/test/obs.test.ts`: detección de capítulos nativos de OBS, escritura solo durante la grabación e informe de errores, reconexión automática con espera creciente (con un obs-websocket simulado).
- `packages/client/test/obs-integration.test.ts`: integración del protocolo OBS WebSocket v5 (ciclo start/pause/resume/stop, cambios dinámicos de FPS, deduplicación de hotkeys Lua, fallback de capítulos).
- `packages/client/test/socket.test.ts`: la Dock no envía nada a una sala hasta que el servidor confirma la entrada, y deja de enviar si la sala ya no existe o se cae la conexión.
- `packages/client/test/sntp-resilience.test.ts`: ráfaga inicial de 4 pings, descarte de picos de jitter, deduplicación de eventos de desconexión y backoff exponencial.
- `packages/client/test/i18n-sound.test.ts`: diccionarios de español e inglés sincronizados (claves y marcadores de posición), interpolación, opciones y sonidos del HUD.

**End-to-end (Playwright):** `npm run build` y después `npm run e2e`. Arranca el servidor compilado en el puerto 3210 con una base de datos desechable y maneja ventanas reales de Chromium como identidades distintas (host, Dock de un streamer, HUD, espectador): inicio de sesión, atajos y deshacer, avisos del HUD, la vuelta atrás desde la vista previa del HUD, edición / borrado de marcadores, historial de sesiones y exportaciones, códigos de sala erróneos, idioma y sonido del HUD, docks estrechos (300px/360px), sincronización de escuadra multi-streamer, descargas de los 5 formatos de exportación, y la Dock perdiendo y recuperando la conexión con el servidor. El WebSocket de OBS está simulado, así que la prueba nunca toca un OBS abierto en la misma máquina. Ejecuta `npx playwright install chromium` una vez antes de la primera prueba.

**Con OBS real:** sigue la lista de [docs/local-testing.es.md](docs/local-testing.es.md) (no hace falta VPS).

---

## 🤝 Comunidad y accesibilidad

StreamCollab da la bienvenida a todas las personas. Por favor, consulta nuestro [Código de conducta](docs/CODE_OF_CONDUCT.es.md) y nuestra [Declaración de accesibilidad](docs/ACCESSIBILITY.es.md) (conformidad WCAG 2.1 Nivel AA). Para contribuir código, traducciones o informes de errores, consulta [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📜 Licencia

Se distribuye bajo la licencia MIT. Consulta [`LICENSE`](./LICENSE) para más información.
