# Accessibility Statement for StreamCollab

**English** | [Español](ACCESSIBILITY.es.md)

StreamCollab aims for the **Web Content Accessibility Guidelines (WCAG) 2.1 Level AA** in the Dock, the Director Panel and the HUD. This is a goal, not a conformance claim: the project has not had an independent accessibility audit. This page says what is checked automatically, what has not been tested yet, and how to report a barrier.

---

## What is checked on every change

- **axe-core (WCAG 2.1 A and AA rules)** runs in the end-to-end suite ([`e2e/a11y.spec.ts`](../e2e/a11y.spec.ts)) in English and Spanish on:
  - the Dock, empty and with a marker and the OBS settings open,
  - the Director Panel, its Start Session dialog and its Export dialog,
  - the Director Panel with a member, markers and a marker being edited,
  - the HUD preview and the live HUD showing a marker toast.

  The build fails on any violation. Automated tools only find part of the WCAG issues (contrast, names, roles, structure); they cannot judge, for example, whether a label is meaningful.
- **Dialogs** (Export, Start Session) are tested in Chromium ([`packages/client/test/components.browser.test.tsx`](../packages/client/test/components.browser.test.tsx)): focus moves into the dialog when it opens, `Tab` / `Shift+Tab` stay inside it, `Escape` closes it and focus returns to the button that opened it.
- **Narrow docks:** the end-to-end suite checks that every Dock control stays on screen at 300, 360 and 420 px wide.
- **Reflow (WCAG 1.4.10):** the end-to-end suite checks that the Director Panel, with a session running, needs no horizontal scrolling at 320 px wide.
- **Focus after Start / Stop Session:** when the Start or Stop button that had the focus is replaced, the new one receives it instead of the page, also when the session was started or stopped from another tab (end-to-end tests).

## What StreamCollab does

- **Keyboard:** every control is a native button, link, input or select. In the Dock, `1`–`5` add a marker and `0` or `Ctrl+Z` / `Cmd+Z` undoes your last one; the shortcuts are ignored while you type in a field, while a dialog is open, when the key is held down, and with `Ctrl` / `Alt` / `Cmd` (other than the undo shortcut).
- **Dialogs** use `role="dialog"`, `aria-modal="true"` and a label taken from their title.
- **Status messages:** "Server disconnected" in the Dock is a `role="status"` element. "Marker not sent" and the trust question for another server are `role="alert"`.
- **Not only color:** marker categories are always shown with their name (and an icon on the Dock buttons), not by color alone.
- **Reduced motion:** with the system setting `prefers-reduced-motion: reduce`, animations and transitions are suppressed.
- **Optional HUD sounds:** a HUD source opened with `?sound=1` plays a short, different tone for each marker category, with `&volume=0..1`, so streamers can hear that a marker landed without looking away from the game.
- **Languages:** the interface is in English and Spanish, and `<html lang>` follows the chosen language for screen readers.

## Not tested yet

- **Screen readers:** StreamCollab has not been tested with NVDA, JAWS, VoiceOver or Windows Narrator.
- **Browsers:** the automated tests run in Chromium (the engine of OBS Studio's docks and browser sources). Firefox and Safari have not been tested.
- **OBS Studio:** keyboard use inside an OBS dock depends on OBS's embedded browser and has only been tried by hand.

## Known limitations

- **HUD:** the overlay used as an OBS browser source has no interactive controls by design; it is a visual (and optionally audio) layer of your stream.
- **Color contrast** is checked by axe on the screens listed above. Other states (for example a HUD toast over your game video) depend on what is behind them.

---

## Feedback and reporting

If something in StreamCollab is hard or impossible to use with your setup, please tell us:

- **Email:** [cristianguerrero1958@outlook.com](mailto:cristianguerrero1958@outlook.com)
- **GitHub Issues:** open a [bug report](https://github.com/Consterna/streamcollab/issues/new?template=bug_report.yml) and add the `accessibility` label.

Please mention the view (Dock, HUD or Director Panel), your browser or OBS version and any assistive technology you use.
