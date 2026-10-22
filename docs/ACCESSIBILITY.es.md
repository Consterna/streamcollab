# Declaración de Accesibilidad para StreamCollab

[English](../ACCESSIBILITY.md) | **Español**

StreamCollab se compromete a garantizar la accesibilidad digital para todos los creadores de contenido, streamers, editores y espectadores, independientemente de sus capacidades físicas, sensoriales o cognitivas. Mejoramos continuamente la experiencia del usuario aplicando los estándares pertinentes de accesibilidad, apuntando a la conformidad con las **Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1 Nivel AA**.

---

## Características de Accesibilidad en StreamCollab

### 1. Panel de OBS Studio y Superposición HUD de Alto Contraste
- **Ratios de Contraste:** El Dock de OBS y el Dashboard de StreamCollab presentan un tema oscuro ergonómico con relaciones de contraste que cumplen o superan 4.5:1 para texto normal y 3:1 para tipografía grande, bordes y controles interactivos de la interfaz.
- **Marcadores Accesibles para Daltonismo:** Las categorías de marcadores (Clip, Funny, Death, Chapter) se diferencian mediante iconografía geométrica definida, tipografía y semántica de forma, sin depender únicamente del color para comunicar estados críticos de operación (WCAG 1.4.1 Uso del Color).
- **Movimiento Reducido:** Las animaciones interactivas y las transiciones de notificaciones en el HUD respetan las preferencias del sistema operativo del usuario (`prefers-reduced-motion: reduce`).

### 2. Navegación Completa por Teclado y Atajos Rápidos
- **Orden de Tabulación Lógico:** Todos los botones interactivos, campos de entrada, interruptores y elementos del historial de sesiones son accesibles mediante navegación secuencial por teclado (`Tab` / `Shift+Tab`).
- **Estados de Foco Visibles:** Anillos de foco claros y de alto contraste (`:focus-visible`) indican la posición del elemento interactivo actual en todas las vistas.
- **Atajos de Teclado:** Los atajos de marcado rápido y la función de deshacer instantáneo (`Ctrl+Z` / `Cmd+Z`) permiten una operación ágil en transmisiones en vivo sin depender del ratón.
- **Captura de Foco y Tecla Escape:** Los diálogos y modales capturan el foco del teclado para evitar la navegación de fondo y se cierran de forma limpia con la tecla `Escape`, devolviendo el foco al elemento de origen.

### 3. Marcado Semántico y WAI-ARIA
- **Puntos de Referencia HTML5:** Las interfaces están estructuradas con etiquetas semánticas nativas (`<header>`, `<nav>`, `<main>`, `<section>`, `<dialog>`) para una navegación rápida mediante lectores de pantalla.
- **Regiones Vivas:** Los cambios dinámicos de estado — como la sincronización horaria SNTP, el estado de conexión de la sala y las confirmaciones de marcado rápido — se anuncian utilizando regiones vivas no invasivas (`aria-live="polite"` y `role="status"`).
- **Alertas Críticas:** La pérdida de conexión, las advertencias de límite de tasa (*rate limit*) o los fallos de sesión utilizan `role="alert"` para retroalimentación inmediata en lectores de pantalla.
- **Etiquetas Descriptivas:** Todos los botones de ícono, campos de formulario y controles desplegables incluyen atributos explícitos `aria-label`, `aria-labelledby` o `aria-describedby`.

### 4. Retroalimentación Auditiva y Señales Sonoras de Asistencia
- **Sintetizador de Sonido HUD:** StreamCollab incluye tonos de audio configurables con frecuencias únicas para cada categoría de marcador. Los streamers pueden comprobar el registro de un marcador sin desviar la mirada de su partida o transmisión.
- **Controles Independientes:** Ajuste completo de volumen e interruptor de silenciado con un clic para una personalización auditiva precisa.

### 5. Escalado Responsivo para OBS
- **Adaptación a Paneles Compactos:** El Dock de OBS se adapta de manera limpia a anchos estrechos (300px a 360px) en OBS Studio sin cortar texto, ocultar botones esenciales ni generar desbordamiento horizontal.

---

## Especificaciones Técnicas y Conformidad

StreamCollab se apoya en las siguientes tecnologías para funcionar con herramientas de asistencia:
- HTML5 y WAI-ARIA
- CSS3 (con Flexbox, CSS Grid y variables de color de alto contraste)
- ECMAScript moderno / React 19
- Motores web Chromium y Firefox modernos, incluidos los docks CEF (Chromium Embedded Framework) de OBS Studio 30+

Tecnologías de asistencia evaluadas:
- Lectores de pantalla: NVDA, JAWS, VoiceOver (macOS) y Narrador de Windows.
- Navegación exclusiva por teclado en Chromium y Firefox.

---

## Limitaciones Conocidas y Soluciones

Aunque StreamCollab se esfuerza por cumplir con WCAG 2.1 AA en todas las interfaces, existen algunas limitaciones del entorno:
- **Captura de Foco en OBS Studio Dock:** En ciertas versiones anteriores de OBS Studio en Windows/Linux, los docks de navegador internos CEF pueden requerir ocasionalmente un primer clic dentro del panel antes de recibir el foco completo del teclado.
- **Transparencia en Fuentes de Navegador HUD:** La superposición HUD transparente diseñada como fuente de navegador en OBS no contiene elementos interactivos con foco por diseño, ya que opera exclusivamente como una capa visual y auditiva de emisión.

---

## Proceso de Retroalimentación y Denuncias

Agradecemos comentarios sobre la accesibilidad de StreamCollab. Si encuentras barreras de accesibilidad, detectas una trampa de foco de teclado o requieres asistencia:

- **Correo electrónico:** [cristianguerrero1958@outlook.com](mailto:cristianguerrero1958@outlook.com)
- **Problemas en GitHub:** Envía un reporte utilizando la [plantilla de reporte de errores](https://github.com/Consterna/streamcollab/issues/new?template=bug_report.yml) con la etiqueta `accessibility`.

Nos comprometemos a revisar y atender las inquietudes reportadas con la máxima prontitud.
