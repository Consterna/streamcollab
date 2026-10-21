# Probar StreamCollab en local (sin VPS)

Todo funciona en un solo PC con OBS. En local además no aplica la restricción de Chrome
"Local Network Access", porque el Dock se carga desde `localhost`.

> Las pruebas automáticas (`npm.cmd test` y `npm.cmd run e2e`) cubren el servidor y la interfaz en un
> navegador. Esta lista cubre lo que **solo se puede comprobar con OBS real**.

## 0. Arrancar

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

Abre `http://localhost:3000/dashboard`. Los datos quedan en `packages/server/streamcollab.sqlite`.

## 1. Sala

- [ ] En el Director Panel: **New room** → **Create**. Aparece "You are the host" y los enlaces del Dock y del HUD.

## 2. Conectar OBS

- [ ] OBS → Herramientas → Configuración del servidor WebSocket → activar (puerto 4455).
- [ ] Docks → Docks personalizados del navegador → pegar el enlace del Dock.
- [ ] En el Dock: **OBS Disconnected** → **Connect** → pasa a **OBS Linked** con tu resolución y FPS.
- [ ] La línea **Chapters** dice que los capítulos están disponibles (OBS 30.2+).

## 3. Marcadores en el Dock

- [ ] Botones y teclas `1`–`5` → el marcador aparece en el Dock y en el Director Panel.
- [ ] `0` o **Undo** → desaparece tu último marcador.

## 4. HUD en pantalla

- [ ] Fuente de navegador con el enlace del HUD, 1920×1080 → al marcar aparece el aviso con fondo transparente.
- [ ] Ocultar la fuente y volver a mostrarla no deja avisos "atascados".

## 5. Hotkeys globales (con el juego en primer plano)

- [ ] Herramientas → Scripts → `+` → `obs-scripts/streamcollab-hotkeys.lua`.
- [ ] Ajustes → Atajos → "StreamCollab" → asignar Kill, Squad Wipe, Clutch, Funny, Note y Undo.
- [ ] Con un juego u otra ventana enfocada, las teclas crean marcadores y la de Undo los quita.

## 6. Grabación y capítulos nativos

- [ ] Ajustes → Salida → Grabación → formato **Hybrid MP4**.
- [ ] Director Panel → **Start New Session**; luego grabar en OBS → el Dock muestra **REC LIVE**.
- [ ] Marcar 3–4 momentos que recuerdes; detener la grabación.
- [ ] Abrir el archivo en un reproductor con capítulos (p. ej. VLC → Reproducción → Capítulo): están en esos momentos.

## 7. Export a DaVinci Resolve

- [ ] Director Panel → **Export Timeline** → **Timeline**: tu nombre (POV) → DaVinci Resolve → descargar `.edl`.
- [ ] Importar el `.edl` con tu grabación: los marcadores caen donde marcaste.

## 8. Varias personas sin VPS

- [ ] Mismo PC: abrir el enlace del Dock en otro navegador o en incógnito (es otro jugador).
- [ ] Otro PC de tu casa: `http://TU-IP-LOCAL:3000/...` (permitir Node en el firewall de Windows).
- [ ] Ambos aparecen en el Director Panel; solo el host puede iniciar o detener sesiones.

## 9. Persistencia

- [ ] `Ctrl+C` en el servidor y `npm.cmd start` otra vez: la sala, las sesiones y los marcadores siguen ahí.

## Si algo falla, anota

- El paso y qué esperabas ver.
- El texto de la línea **Chapters** del Dock y cualquier aviso amarillo.
- Una captura del Dock o del Director Panel.
