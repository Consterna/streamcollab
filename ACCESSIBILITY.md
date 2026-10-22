# Accessibility Statement for StreamCollab

**English** | [Español](docs/ACCESSIBILITY.es.md)

StreamCollab is committed to ensuring digital accessibility for all content creators, streamers, editors, and viewers, regardless of physical, sensory, or cognitive abilities. We continually improve the user experience for everyone and apply relevant accessibility standards, targeting conformance with the **Web Content Accessibility Guidelines (WCAG) 2.1 Level AA**.

---

## Accessibility Features in StreamCollab

### 1. High-Contrast Studio Dock & HUD Overlay
- **Contrast Ratios:** The StreamCollab OBS Dock and Dashboard feature an ergonomic dark theme with contrast ratios meeting or exceeding 4.5:1 for normal body text and 3:1 for large typography, borders, and interactive UI controls.
- **Color-Blind Accessible Markers:** Marker categories (Clip, Funny, Death, Chapter) are differentiated by distinct geometric iconography, typography, and shape semantics, never relying solely on color hue to convey critical operational status (WCAG 1.4.1 Use of Color).
- **Reduced Motion:** Interactive animations and HUD toast transitions respect the user's operating system preferences (`prefers-reduced-motion: reduce`).

### 2. Comprehensive Keyboard Navigation & Hotkeys
- **Logical Tab Order:** All actionable buttons, inputs, toggles, and session history items are accessible via sequential keyboard navigation (`Tab` / `Shift+Tab`).
- **Visible Focus States:** Clear, high-contrast focus rings (`:focus-visible`) indicate current interactive element placement across all views.
- **Keyboard Shortcuts:** Quick-marking hotkeys and instant undo (`Ctrl+Z` / `Cmd+Z`) allow fast-paced live operation without mouse reliance.
- **Focus Traps & Escape Handlers:** Modals and dialogs trap keyboard focus to prevent background traversal and dismiss cleanly with the `Escape` key, restoring focus to the triggering element.

### 3. Semantic Markup & WAI-ARIA
- **HTML5 Landmarks:** User interfaces are structured with native landmarks (`<header>`, `<nav>`, `<main>`, `<section>`, `<dialog>`) for swift screen-reader navigation.
- **Live Regions:** Dynamic status changes — such as live SNTP clock synchronization offsets, room connection states, and quick-marker confirmations — are announced using non-intrusive live regions (`aria-live="polite"` and `role="status"`).
- **Critical Alerts:** Connection loss, rate-limiting warnings, or session errors utilize `role="alert"` for immediate screen-reader feedback.
- **Descriptive Labels:** All icon buttons, form fields, and dropdown controls include explicit `aria-label`, `aria-labelledby`, or `aria-describedby` attributes.

### 4. Auditory Feedback & Assistive Sound Cues
- **HUD Sound Synthesizer:** StreamCollab includes configurable audio tones with unique frequencies for each marker category. Streamers can audit marker captures without looking away from their game or broadcast.
- **Independent Controls:** Complete volume adjustment and one-click mute toggles enable fine-grained auditory customization.

### 5. Responsive Studio Scaling
- **Compact Dock Adaptation:** The OBS Dock scales cleanly down to narrow widths (300px to 360px) in OBS Studio without clipping text, truncation of critical buttons, or horizontal viewport overflow.

---

## Technical Specifications & Conformance

StreamCollab relies on the following technologies to work with assistive tools:
- HTML5 & WAI-ARIA
- CSS3 (with Flexbox, CSS Grid, and high-contrast color variables)
- Modern ECMAScript / React 19
- Modern Chromium and Firefox web engines, including OBS Studio 30+ CEF (Chromium Embedded Framework) docks

Tested assistive technologies include:
- Screen readers: NVDA, JAWS, VoiceOver (macOS), and Windows Narrator.
- Keyboard-only navigation across Chromium and Firefox.

---

## Known Limitations & Workarounds

While StreamCollab strives to adhere to WCAG 2.1 AA across all interfaces, some platform constraints exist:
- **OBS Studio Dock Focus Capture:** In certain older OBS Studio versions on Windows/Linux, internal CEF browser docks may occasionally require an initial mouse click inside the dock panel before receiving full keyboard input focus.
- **HUD Browser Source Transparency:** The transparent HUD overlay intended as an OBS browser source does not contain focusable interactive elements by design, as it operates as a visual/audio broadcast layer.

---

## Feedback and Reporting Process

We welcome feedback on the accessibility of StreamCollab. If you encounter accessibility barriers, discover a keyboard trap, or need assistance:

- **Email:** [cristianguerrero1958@outlook.com](mailto:cristianguerrero1958@outlook.com)
- **GitHub Issues:** Submit an issue using the [Bug Report template](https://github.com/Consterna/streamcollab/issues/new?template=bug_report.yml) and include the `accessibility` label.

We aim to acknowledge and address reported accessibility concerns promptly.
