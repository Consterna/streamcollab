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

  it('verifies ExportModal markup provides WAI-ARIA dialog semantics and Escape key handler', () => {
    const modalPath = path.resolve(__dirname, '../src/components/ExportModal.tsx');
    const modalContent = fs.readFileSync(modalPath, 'utf8');

    expect(modalContent).toContain('role="dialog"');
    expect(modalContent).toContain('aria-modal="true"');
    expect(modalContent).toContain('aria-labelledby="export-modal-title"');
    expect(modalContent).toContain('id="export-modal-title"');
    expect(modalContent).toContain("aria-label={t('common.close')}");
    expect(modalContent).toContain("e.key === 'Escape'");
  });

  it('verifies DashboardView Start Session modal provides WAI-ARIA dialog semantics and Escape handler', () => {
    const dashPath = path.resolve(__dirname, '../src/views/DashboardView.tsx');
    const dashContent = fs.readFileSync(dashPath, 'utf8');

    expect(dashContent).toContain('role="dialog"');
    expect(dashContent).toContain('aria-modal="true"');
    expect(dashContent).toContain('aria-labelledby="start-session-modal-title"');
    expect(dashContent).toContain('id="start-session-modal-title"');
    expect(dashContent).toContain("e.key === 'Escape'");
  });
});
