import { test, expect, newIdentity, createRoom, becomeHost, openView, markersCaptured } from './fixtures';

test.describe('Squad flow: host, dock and HUD', () => {
  test('host starts a session, a dock marks / undoes and the HUD shows the toast', async ({ browser, request }) => {
    const room = await createRoom(request);

    const hostContext = await newIdentity(browser);
    await becomeHost(hostContext, room);
    const dashboard = await openView(hostContext, 'dashboard', room.id);
    await expect(dashboard.getByText('You are the host')).toBeVisible();
    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();
    await expect(dashboard.getByText('LIVE RECORDING')).toBeVisible();

    const streamer = await newIdentity(browser);
    const dock = await openView(streamer, 'dock', room.id);
    await markersCaptured(dock, 0);

    const viewers = await newIdentity(browser);
    const hud = await openView(viewers, 'hud', room.id);
    await expect(hud.getByText(/STREAMCOLLAB SQUAD/i)).toBeVisible();

    // Dock hotkeys 1..5 create markers; 0 undoes the streamer's own last one
    await dock.keyboard.press('1');
    await markersCaptured(dock, 1);
    await dock.keyboard.press('2');
    await markersCaptured(dock, 2);
    await expect(hud.getByText('Squad Wipe')).toBeVisible();

    await dock.keyboard.press('0');
    await markersCaptured(dock, 1);

    // The director sees the remaining marker live
    await expect(dashboard.getByText('Kill Confirmed')).toBeVisible();
    await expect(dashboard.getByText('Squad Wipe', { exact: true })).toHaveCount(0);
  });

  test('the HUD preview opened from the app always has a way back', async ({ browser, request }) => {
    const room = await createRoom(request);
    const context = await newIdentity(browser);
    await becomeHost(context, room);

    const page = await openView(context, 'dashboard', room.id);
    await page.getByRole('button', { name: 'OBS Overlay HUD' }).click();
    await expect(page).toHaveURL(/view=hud.*preview=1/);
    await expect(page.locator('nav')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/view=dashboard/);
    await expect(page.getByRole('button', { name: 'Director Panel' })).toBeVisible();

    await page.getByRole('button', { name: 'OBS Overlay HUD' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/view=dashboard/);

    // Reloading the preview keeps it (and its Back button)
    await page.getByRole('button', { name: 'OBS Overlay HUD' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

    // The clean OBS link never shows the preview controls
    await page.goto(`/?view=hud&room=${room.id}`);
    await expect(page.getByText(/STREAMCOLLAB SQUAD/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
  });
});

test.describe('Director tools', () => {
  test('the host edits and deletes markers; a viewer cannot', async ({ browser, request }) => {
    const room = await createRoom(request);

    const streamer = await newIdentity(browser);
    const dock = await openView(streamer, 'dock', room.id);
    await markersCaptured(dock, 0);
    await dock.keyboard.press('3');
    await dock.keyboard.press('4');
    await markersCaptured(dock, 2);

    const hostContext = await newIdentity(browser);
    await becomeHost(hostContext, room);
    const dashboard = await openView(hostContext, 'dashboard', room.id);
    await expect(dashboard.getByText('Clutch Play')).toBeVisible();

    const clutchRow = dashboard.locator('.group', { hasText: 'Clutch Play' });
    await clutchRow.hover();
    await clutchRow.getByRole('button', { name: 'Edit marker' }).click();
    await dashboard.getByLabel('Label').fill('Clutch 1v4');
    await dashboard.getByLabel('Comment').fill('final circle');
    await dashboard.getByRole('button', { name: 'Save' }).click();
    await expect(dashboard.getByText('Clutch 1v4')).toBeVisible();
    // The edit reaches the streamer's dock too
    await expect(dock.getByText('Clutch 1v4')).toBeVisible();

    const funnyRow = dashboard.locator('.group', { hasText: 'Funny Moment' });
    await funnyRow.hover();
    await funnyRow.getByRole('button', { name: 'Delete marker' }).click();
    await expect(dashboard.getByText('Funny Moment', { exact: true })).toHaveCount(0);
    await markersCaptured(dock, 1);

    // A viewer without the host token can't edit or control sessions
    const viewer = await newIdentity(browser);
    const viewerDashboard = await openView(viewer, 'dashboard', room.id);
    await expect(viewerDashboard.getByText('Viewing only')).toBeVisible();
    await expect(viewerDashboard.getByRole('button', { name: 'Edit marker' })).toHaveCount(0);
    await expect(viewerDashboard.getByRole('button', { name: /Start New Session|Stop Session/ })).toBeDisabled();
  });

  test('session history opens a past session and exports it', async ({ browser, request }) => {
    const room = await createRoom(request);
    const hostContext = await newIdentity(browser);
    await becomeHost(hostContext, room);
    const dashboard = await openView(hostContext, 'dashboard', room.id);

    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByLabel(/Session Name/i).fill('Round 1');
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();

    const streamer = await newIdentity(browser);
    const dock = await openView(streamer, 'dock', room.id);
    await markersCaptured(dock, 0);
    await dock.keyboard.press('5');
    await markersCaptured(dock, 1);

    await dashboard.getByRole('button', { name: 'Stop Session' }).click();
    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByLabel(/Session Name/i).fill('Round 2');
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();
    await expect(dashboard.getByText('Live Event Timeline')).toBeVisible();

    const history = dashboard.locator('li button', { hasText: 'Round 1' });
    await expect(history).toContainText('1 markers');
    await history.click();
    await expect(dashboard.getByText('Session Timeline: Round 1')).toBeVisible();
    await expect(dashboard.getByText('Timeline Note')).toBeVisible();

    const sessions = await (await request.get(`/api/rooms/${room.id}/sessions`)).json();
    const round1 = sessions.find((s: { name: string }) => s.name === 'Round 1');
    await expect(dashboard.locator('a[href*="/export/edl"]')).toHaveAttribute(
      'href',
      new RegExp(`sessionId=${round1.id}`)
    );

    await dashboard.getByRole('button', { name: 'Back to current' }).click();
    await expect(dashboard.getByText('Live Event Timeline')).toBeVisible();
  });

  test('a wrong room code shows a clear message', async ({ browser }) => {
    const context = await newIdentity(browser);
    const dock = await openView(context, 'dock', 'NOPE-0000');
    await expect(dock.getByText(/Room NOPE-0000 not found/)).toBeVisible();
  });
});

test.describe('Room cleanup', () => {
  test('the host removes offline members and deletes finished sessions', async ({ browser, request }) => {
    const room = await createRoom(request);
    const hostContext = await newIdentity(browser);
    await becomeHost(hostContext, room);
    const dashboard = await openView(hostContext, 'dashboard', room.id);

    // A streamer joins, then closes their dock
    const streamer = await newIdentity(browser);
    const dock = await openView(streamer, 'dock', room.id);
    await markersCaptured(dock, 0);
    const streamerName = (await dock.locator('nav input').first().inputValue()).trim();
    await expect(dashboard.getByText(streamerName)).toBeVisible();
    await dock.close();

    const memberRow = dashboard.locator('tr', { hasText: streamerName });
    await expect(memberRow.getByText(/OFFLINE/)).toBeVisible();
    await memberRow.getByRole('button', { name: 'Remove' }).click();
    await expect(dashboard.getByText(streamerName)).toHaveCount(0);

    // Two sessions; the finished one can be deleted from the history
    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByLabel(/Session Name/i).fill('Throwaway');
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();
    await dashboard.getByRole('button', { name: 'Stop Session' }).click();
    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByLabel(/Session Name/i).fill('Keeper');
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();

    const throwaway = dashboard.locator('li', { hasText: 'Throwaway' });
    await expect(throwaway).toBeVisible();
    await throwaway.hover();
    await throwaway.getByRole('button', { name: 'Delete session Throwaway' }).click();
    await expect(dashboard.locator('li', { hasText: 'Throwaway' })).toHaveCount(0);
    await expect(dashboard.locator('li', { hasText: 'Keeper' })).toBeVisible();
  });

  test('room codes work in lower case', async ({ browser, request }) => {
    const room = await createRoom(request);
    const context = await newIdentity(browser);
    const dock = await openView(context, 'dock', room.id.toLowerCase());
    await markersCaptured(dock, 0);
    await expect(dock.locator('nav input').nth(1)).toHaveValue(room.id);
  });
});

test.describe('Language and sound', () => {
  test('the UI follows ?lang=es and the selector switches language', async ({ browser, request }) => {
    const room = await createRoom(request);
    const context = await newIdentity(browser);
    const dock = await context.newPage();
    await dock.goto(`/?view=dock&room=${room.id}&lang=es`);

    await expect(dock.getByText('0 marcadores registrados')).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Deshacer' })).toBeVisible();
    await expect(dock.locator('html')).toHaveAttribute('lang', 'es');

    // Default marker labels come from the marking streamer's language
    await dock.keyboard.press('1');
    await expect(dock.getByText('Kill confirmada')).toBeVisible();

    await dock.getByRole('combobox', { name: 'Idioma' }).selectOption('en');
    await expect(dock.getByText('1 markers captured')).toBeVisible();
    // Already stored markers keep their original label
    await expect(dock.getByText('Kill confirmada')).toBeVisible();
  });

  test('the HUD plays a cue only when its link enables sound', async ({ browser, request }) => {
    const room = await createRoom(request);

    // Count scheduled oscillators instead of producing real audio
    const instrumented = async () => {
      const context = await newIdentity(browser);
      await context.addInitScript(() => {
        const w = window as unknown as { __oscillators: number; AudioContext: typeof AudioContext };
        w.__oscillators = 0;
        const Original = w.AudioContext;
        w.AudioContext = class extends Original {
          createOscillator() {
            w.__oscillators++;
            return super.createOscillator();
          }
        };
      });
      return context;
    };

    const silentHud = await (await instrumented()).newPage();
    await silentHud.goto(`/?view=hud&room=${room.id}`);
    const loudHud = await (await instrumented()).newPage();
    await loudHud.goto(`/?view=hud&room=${room.id}&sound=1&volume=0.5`);
    await expect(loudHud.getByText(/STREAMCOLLAB SQUAD/i)).toBeVisible();

    const dock = await openView(await newIdentity(browser), 'dock', room.id);
    await markersCaptured(dock, 0);
    await dock.keyboard.press('3');
    await expect(loudHud.getByText('Clutch Play')).toBeVisible();
    await expect(silentHud.getByText('Clutch Play')).toBeVisible();

    const count = (page: typeof dock) =>
      page.evaluate(() => (window as unknown as { __oscillators: number }).__oscillators);
    expect(await count(loudHud)).toBe(4); // the clutch cue has four notes
    expect(await count(silentHud)).toBe(0);
  });
});

test.describe('Narrow OBS docks', () => {
  test('every control stays on screen in a 420 px wide dock (longest language)', async ({ browser, request }) => {
    const room = await createRoom(request);
    const context = await newIdentity(browser);
    const dock = await context.newPage();
    await dock.setViewportSize({ width: 420, height: 700 });
    await dock.goto(`/?view=dock&room=${room.id}&lang=es`);
    await expect(dock.getByText('0 marcadores registrados')).toBeVisible();

    const offscreen = await dock.evaluate(() =>
      [...document.querySelectorAll('button, input, select')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
        })
        .map((el) => el.textContent?.trim() || el.getAttribute('placeholder') || el.tagName)
    );
    expect(offscreen).toEqual([]);
    expect(await dock.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(420);
  });
});

test.describe('Server connection', () => {
  test('the dock says it lost the server, flags unsent markers and recovers', async ({ browser, request }) => {
    const room = await createRoom(request);
    const context = await newIdentity(browser);
    // Refuse the StreamCollab socket until the "server" comes back (OBS's own socket stays mocked)
    let serverUp = false;
    await context.routeWebSocket(/\/ws$/, (ws) => {
      if (serverUp) {
        ws.connectToServer();
      } else {
        ws.close({ code: 1001, reason: 'E2E: server unreachable' });
      }
    });
    const dock = await openView(context, 'dock', room.id);
    await expect(dock.getByText('Server disconnected · reconnecting')).toBeVisible();

    await dock.keyboard.press('1');
    await expect(dock.getByRole('alert')).toContainText('Marker not sent');
    await markersCaptured(dock, 0);

    // The client retries every 2 s; once the server answers, the warning goes and marking works again
    serverUp = true;
    await expect(dock.getByText('Server disconnected · reconnecting')).toHaveCount(0, { timeout: 10_000 });
    // (the socket can be open a moment before the room accepts it again, so retry the press until it lands)
    await expect(async () => {
      await dock.keyboard.press('1');
      await markersCaptured(dock, 1);
    }).toPass({ timeout: 10_000 });
  });
});
