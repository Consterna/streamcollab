import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, newIdentity, createRoom, becomeHost } from './fixtures';

// Automated WCAG 2.1 A / AA checks (axe-core). They catch a part of WCAG only: contrast, names,
// roles, structure. Keyboard flows are covered by the tests themselves.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} – ` +
      v.nodes
        .map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)} ${JSON.stringify(n.any[0]?.data ?? {})}`)
        .join(' | ')
  );
  expect(summary, `${label}: axe WCAG 2.1 AA violations`).toEqual([]);
}

for (const lang of ['en', 'es'] as const) {
  test.describe(`Accessibility (axe, ${lang})`, () => {
    test('dock, HUD preview and Director Panel with its dialogs', async ({ browser, request }) => {
      const room = await createRoom(request);
      const host = await newIdentity(browser);
      await becomeHost(host, room);
      const page = await host.newPage();
      // Panels fade in: without this, axe could measure text halfway through the animation
      await page.emulateMedia({ reducedMotion: 'reduce' });
      page.on('dialog', (dialog) => dialog.accept());

      await page.goto(`/?view=dock&room=${room.id}&lang=${lang}`);
      await expect(page.locator('main')).toBeVisible();
      await expectNoViolations(page, 'dock');

      await page.goto(`/?view=dashboard&room=${room.id}&lang=${lang}`);
      const start = page.getByRole('button', { name: lang === 'en' ? 'Start New Session' : 'Iniciar nueva sesión' });
      await expect(start).toBeEnabled();
      await expectNoViolations(page, 'director panel');

      await start.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoViolations(page, 'start session dialog');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: lang === 'en' ? 'Start Recording' : 'Iniciar grabación' })
        .click();
      await expect(page.getByRole('dialog')).toBeHidden();

      await page.getByRole('button', { name: lang === 'en' ? 'Export Timeline' : 'Exportar línea de tiempo' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoViolations(page, 'export dialog');

      await page.goto(`/?view=hud&preview=1&room=${room.id}&lang=${lang}`);
      await expect(page.locator('body')).toBeVisible();
      await expectNoViolations(page, 'HUD preview');

      await page.goto(`/?view=dock&room=${room.id}&lang=${lang}`);
      // Back on the dock (the session above is running): a marker in the history, OBS settings open
      await expect(page.getByText(lang === 'en' ? '0 markers captured' : '0 marcadores registrados')).toBeVisible();
      await page.keyboard.press('1');
      await expect(page.getByText(lang === 'en' ? '1 markers captured' : '1 marcadores registrados')).toBeVisible();
      await page.getByTitle(lang === 'en' ? 'OBS WebSocket settings' : 'Ajustes del WebSocket de OBS').click();
      await expectNoViolations(page, 'dock with a marker and OBS settings');
    });
  });
}
