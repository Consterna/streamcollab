# Declaración de accesibilidad de StreamCollab

[English](ACCESSIBILITY.md) | **Español**

StreamCollab busca cumplir las **Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1, nivel AA** en la Dock, el Panel del director y el HUD. Es un objetivo, no una declaración de conformidad: el proyecto no ha pasado una auditoría de accesibilidad independiente. Esta página explica qué se comprueba automáticamente, qué no se ha probado todavía y cómo informar de una barrera.

---

## Qué se comprueba en cada cambio

- **axe-core (reglas WCAG 2.1 A y AA)** se ejecuta en la suite end-to-end ([`e2e/a11y.spec.ts`](e2e/a11y.spec.ts)), en inglés y en español, sobre:
  - la Dock, vacía y con un marcador y los ajustes de OBS abiertos,
  - el Panel del director, su diálogo de inicio de sesión y su diálogo de exportación,
  - la vista previa del HUD.

  Cualquier infracción hace fallar el build. Las herramientas automáticas solo detectan una parte de los problemas WCAG (contraste, nombres, roles, estructura); no pueden juzgar, por ejemplo, si una etiqueta tiene sentido.
- **Diálogos** (Exportar, Iniciar sesión): se prueban en Chromium ([`packages/client/test/components.browser.test.tsx`](packages/client/test/components.browser.test.tsx)). Al abrirse, el foco entra en el diálogo; `Tab` / `Mayús+Tab` no salen de él; `Escape` lo cierra y el foco vuelve al botón que lo abrió.
- **Docks estrechas:** la suite end-to-end comprueba que todos los controles de la Dock siguen en pantalla con 300, 360 y 420 px de ancho.

## Qué hace StreamCollab

- **Teclado:** todos los controles son botones, enlaces, campos o desplegables nativos. En la Dock, `1`–`5` añaden un marcador y `0` o `Ctrl+Z` / `Cmd+Z` deshacen el último tuyo. Los atajos se ignoran mientras escribes en un campo, con un diálogo abierto, al mantener la tecla pulsada y con `Ctrl` / `Alt` / `Cmd` (salvo el atajo de deshacer).
- **Diálogos** con `role="dialog"`, `aria-modal="true"` y una etiqueta tomada de su título.
- **Mensajes de estado:** "Servidor desconectado" en la Dock es un elemento `role="status"`. "Marcador no enviado" y la pregunta de confianza en otro servidor son `role="alert"`.
- **No solo color:** las categorías de marcador siempre se muestran con su nombre (y un icono en los botones de la Dock), nunca solo con un color.
- **Movimiento reducido:** con la preferencia del sistema `prefers-reduced-motion: reduce` se suprimen animaciones y transiciones.
- **Sonidos opcionales del HUD:** una fuente HUD abierta con `?sound=1` reproduce un tono corto y distinto para cada categoría, con `&volume=0..1`, para que el streamer oiga que el marcador se registró sin apartar la vista del juego.
- **Idiomas:** la interfaz está en inglés y en español, y `<html lang>` sigue el idioma elegido para los lectores de pantalla.

## Qué no se ha probado todavía

- **Lectores de pantalla:** StreamCollab no se ha probado con NVDA, JAWS, VoiceOver ni el Narrador de Windows.
- **Navegadores:** los tests automáticos se ejecutan en Chromium (el motor de las docks y fuentes de navegador de OBS Studio). Firefox y Safari no se han probado.
- **OBS Studio:** el uso con teclado dentro de una dock de OBS depende de su navegador integrado y solo se ha probado a mano.

## Limitaciones conocidas

- **HUD:** la superposición que se usa como fuente de navegador en OBS no tiene controles interactivos a propósito; es una capa visual (y opcionalmente sonora) de tu emisión.
- **Contraste de color:** axe lo comprueba en las pantallas indicadas arriba. Otros estados (por ejemplo, un aviso del HUD sobre el vídeo de tu juego) dependen de lo que haya detrás.

---

## Comentarios e informes

Si algo de StreamCollab te resulta difícil o imposible de usar con tu configuración, cuéntanoslo:

- **Correo:** [cristianguerrero1958@outlook.com](mailto:cristianguerrero1958@outlook.com)
- **GitHub Issues:** abre un [informe de error](https://github.com/Consterna/streamcollab/issues/new?template=bug_report.yml) y añade la etiqueta `accessibility`.

Indica la vista (Dock, HUD o Panel del director), tu navegador o versión de OBS y la tecnología de apoyo que uses.
