import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';

describe('Accessibility & WCAG Conformance Verification', () => {
  it('suppresses animations and transitions under prefers-reduced-motion in index.css', () => {
    const cssPath = path.resolve(__dirname, '../src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    expect(cssContent).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssContent).toContain('animation-duration: 0.01ms !important');
    expect(cssContent).toContain('transition-duration: 0.01ms !important');
  });

  it('guarantees common.close and accessibility keys in both language dictionaries', () => {
    expect(en['common.close']).toBe('Close');
    expect(es['common.close']).toBe('Cerrar');
    expect(en['hudPreview.backTitle']).toContain('(Esc)');
    expect(es['hudPreview.backTitle']).toContain('(Esc)');
  });
  // Dialog semantics, focus and Escape are tested on the rendered components (components.browser.test.tsx)
  // and with axe in the E2E run (e2e/a11y.spec.ts)
});
