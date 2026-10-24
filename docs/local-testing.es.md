[English](local-testing.md) | **Español**

# Probar StreamCollab en local (sin VPS)

Todo funciona en un solo PC con OBS. En local además no aplica la restricción de Chrome
"Local Network Access", porque la Dock se carga desde `localhost`.

> Las pruebas automáticas (`npm test` y `npm run e2e`) cubren el servidor y la interfaz en un
> navegador. Esta lista cubre lo que **solo se puede comprobar con OBS real**.

> En Windows PowerShell, usa `npm.cmd` si la ejecución de scripts está bloqueada.

## 0. Arrancar

```bash
npm install
npm run build
npm start
```

Abre `http://localhost:3000/dashboard`. Los datos quedan en `packages/server/streamcollab.sqlite`.

Sin Node.js, puedes usar la imagen Docker del README (inicio rápido, opción A); entonces los datos quedan en el
volumen `streamcollab-data`.

## 1. Sala

- [ ] En el Panel del director: **Nueva sala** → **Crear**. Aparece "Eres el host" y los enlaces de la Dock y del HUD.

## 2. Conectar OBS

- [ ] OBS → Herramientas → Configuración del servidor WebSocket → activar (puerto 4455).
- [ ] Docks → Docks personalizados del navegador → pegar el enlace de la Dock.
- [ ] En la Dock: **OBS desconectado** → **Conectar** → pasa a **OBS conectado** con tu resolución y FPS.
- [ ] La línea **Capítulos** dice que los capítulos están disponibles (OBS 30.2+).

## 3. Marcadores en la Dock

- [ ] Botones y teclas `1`–`5` → el marcador aparece en la Dock y en el Panel del director.
- [ ] `0` o **Deshacer** → desaparece tu último marcador.

## 4. HUD en pantalla

- [ ] Fuente de navegador con el enlace del HUD, 1920×1080 → al marcar aparece el aviso con fondo transparente.
- [ ] Ocultar la fuente y volver a mostrarla no deja avisos "atascados".

## 5. Atajos globales (con el juego en primer plano)

- [ ] Herramientas → Scripts → `+` → `streamcollab-hotkeys.lua` (de la página de releases o de `obs-scripts/`).
- [ ] Ajustes → Atajos → "StreamCollab" → asignar Kill, Squad Wipe, Clutch, Funny, Note y Undo.
- [ ] Con un juego u otra ventana enfocada, las teclas crean marcadores y la de Undo los quita.

## 6. Grabación y capítulos nativos

- [ ] Ajustes → Salida → Grabación → formato **Hybrid MP4**.
- [ ] Panel del director → **Iniciar nueva sesión**; luego grabar en OBS → la Dock muestra **GRABANDO**.
- [ ] Marcar 3–4 momentos que recuerdes; detener la grabación.
- [ ] Abrir el archivo en un reproductor con capítulos (p. ej. VLC → Reproducción → Capítulo): están en esos momentos.

## 7. Export a DaVinci Resolve

- [ ] Panel del director → **Exportar línea de tiempo** → **Línea de tiempo**: tu nombre (POV) → DaVinci Resolve → descargar `.edl`.
- [ ] Pon tu grabación en una línea de tiempo que empiece en 00:00:00:00 y luego, clic derecho en la línea de tiempo en el Media Pool → **Timelines** → **Import** → **Timeline Markers from EDL...**: los marcadores caen donde marcaste, con sus colores.

## 8. Varias personas sin VPS

- [ ] Mismo PC: abrir el enlace de la Dock en otro navegador o en incógnito (es otro jugador).
- [ ] Otro PC de tu casa: `http://TU-IP-LOCAL:3000/...` (permitir Node en el firewall de Windows).
- [ ] Ambos aparecen en el Panel del director; solo el host puede iniciar o detener sesiones.

## 9. Persistencia y reconexión

- [ ] `Ctrl+C` en el servidor: la Dock muestra **Servidor desconectado · reconectando**, y si marcas avisa de que el marcador no se envió.
- [ ] `npm start` otra vez: la Dock vuelve a conectarse y la sala, las sesiones y los marcadores siguen ahí.

## Si algo falla, anota

- El paso y qué esperabas ver.
- El texto de la línea **Capítulos** de la Dock y cualquier aviso amarillo.
- Una captura de la Dock o del Panel del director.
