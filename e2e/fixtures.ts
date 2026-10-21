import { test as base, expect, BrowserContext, Page, APIRequestContext } from '@playwright/test';

export interface TestRoom {
  id: string;
  hostToken: string;
}

/**
 * Each browser context is a separate identity (its own localStorage, member id and tokens).
 * OBS's local WebSocket is mocked and closed, so tests never reach a real OBS on this machine.
 */
export async function newIdentity(browser: { newContext: () => Promise<BrowserContext> }): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.routeWebSocket(/:4455\/?$/, (ws) => ws.close({ code: 1000, reason: 'OBS mocked in E2E' }));
  return context;
}

export async function createRoom(request: APIRequestContext, name = 'E2E Squad'): Promise<TestRoom> {
  const res = await request.post('/api/rooms', { data: { name } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { id: body.id, hostToken: body.hostToken };
}

/** Make this context the room host by storing the host token where the app looks for it */
export async function becomeHost(context: BrowserContext, room: TestRoom) {
  await context.addInitScript(({ id, token }) => window.localStorage.setItem(`streamcollab_host_token:${id}`, token), {
    id: room.id,
    token: room.hostToken,
  });
}

export async function openView(context: BrowserContext, view: 'dock' | 'hud' | 'dashboard', roomId: string) {
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`/?view=${view}&room=${roomId}`);
  return page;
}

export async function markersCaptured(dock: Page, count: number) {
  await expect(dock.getByText(`${count} markers captured`)).toBeVisible();
}

export const test = base;
export { expect };
