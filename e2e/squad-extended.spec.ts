import { test, expect, newIdentity, createRoom, becomeHost, openView, markersCaptured } from './fixtures';
import { DOMParser } from '@xmldom/xmldom';

test.describe('Extended squad flow: multi-streamer squad synchronization', () => {
  test('host creates room and starts session; two streamers join docks, mark events, and see synchronized stop', async ({
    browser,
    request,
  }) => {
    const room = await createRoom(request, 'Squad Sync Test');

    // 1. Host opens dashboard and starts session
    const hostContext = await newIdentity(browser);
    await becomeHost(hostContext, room);
    const dashboard = await openView(hostContext, 'dashboard', room.id);
    await expect(dashboard.getByText('You are the host')).toBeVisible();

    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByLabel(/Session Name/i).fill('Championship Match');
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();
    await expect(dashboard.getByText('LIVE RECORDING')).toBeVisible();

    // 2. Streamer 1 (Alpha) joins dock
    const streamer1 = await newIdentity(browser);
    const dock1 = await openView(streamer1, 'dock', room.id);
    await markersCaptured(dock1, 0);
    await expect(dock1.getByText('Championship Match')).toBeVisible();

    // 3. Streamer 2 (Bravo) joins dock
    const streamer2 = await newIdentity(browser);
    const dock2 = await openView(streamer2, 'dock', room.id);
    await markersCaptured(dock2, 0);
    await expect(dock2.getByText('Championship Match')).toBeVisible();

    // 4. Streamer 1 adds markers
    await dock1.keyboard.press('1'); // Kill
    await markersCaptured(dock1, 1);
    await markersCaptured(dock2, 1);

    await dock1.keyboard.press('3'); // Clutch
    await markersCaptured(dock1, 2);
    await markersCaptured(dock2, 2);

    // 5. Streamer 2 adds markers
    await dock2.keyboard.press('2'); // Wipe
    await markersCaptured(dock1, 3);
    await markersCaptured(dock2, 3);

    await dock2.keyboard.press('4'); // Funny
    await markersCaptured(dock1, 4);
    await markersCaptured(dock2, 4);

    // Dashboard reflects all 4 markers
    await expect(dashboard.getByText('Kill Confirmed')).toBeVisible();
    await expect(dashboard.getByText('Clutch Play')).toBeVisible();
    await expect(dashboard.getByText('Squad Wipe', { exact: true })).toBeVisible();
    await expect(dashboard.getByText('Funny Moment')).toBeVisible();

    // 6. Host stops session
    await dashboard.getByRole('button', { name: 'Stop Session' }).click();
    await expect(dashboard.getByRole('button', { name: 'Start New Session' })).toBeVisible();

    // Docks observe session transition to ended
    await expect(dock1.getByText(/Championship Match \(Ended\)/)).toBeVisible();
    await expect(dock2.getByText(/Championship Match \(Ended\)/)).toBeVisible();
    await markersCaptured(dock1, 4);
    await markersCaptured(dock2, 4);
  });
});

test.describe('Export downloads validation', () => {
  test('downloads and validates EDL, XML, CSV, YouTube chapters, and JSON sync matrix', async ({
    browser,
    request,
  }) => {
    const room = await createRoom(request, 'Export Test Squad');

    // Setup host and session with markers
    const hostContext = await newIdentity(browser);
    await becomeHost(hostContext, room);
    const dashboard = await openView(hostContext, 'dashboard', room.id);

    await dashboard.getByRole('button', { name: 'Start New Session' }).click();
    await dashboard.getByLabel(/Session Name/i).fill('Export Suite Session');
    await dashboard.getByRole('button', { name: 'Start Recording' }).click();

    const streamer = await newIdentity(browser);
    const dock = await openView(streamer, 'dock', room.id);
    await markersCaptured(dock, 0);

    // Generate at least 3 markers for YouTube chapters support
    await dock.keyboard.press('1'); // Kill
    await markersCaptured(dock, 1);
    await dock.keyboard.press('2'); // Wipe
    await markersCaptured(dock, 2);
    await dock.keyboard.press('3'); // Clutch
    await markersCaptured(dock, 3);
    await dock.keyboard.press('5'); // Note
    await markersCaptured(dock, 4);

    // Stop session so all exports are finalized
    await dashboard.getByRole('button', { name: 'Stop Session' }).click();
    await expect(dashboard.getByRole('button', { name: 'Start New Session' })).toBeVisible();

    // Open Export Modal
    await dashboard.getByRole('button', { name: 'Export Timeline' }).click();
    await expect(dashboard.getByText('Export Timeline')).toBeVisible();

    // Helper to click format tab, download, and return file text
    const downloadFormat = async (formatTabName: string, expectedExt: string) => {
      await dashboard.getByRole('button', { name: new RegExp(formatTabName, 'i') }).click();

      const downloadPromise = dashboard.waitForEvent('download');
      await dashboard.getByRole('button', { name: 'Download File' }).click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toContain(`.${expectedExt}`);
      const stream = await download.createReadStream();
      if (!stream) throw new Error('No download stream');

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    };

    // 1. EDL (CMX 3600 with CRLF)
    const edlContent = await downloadFormat('DaVinci Resolve', 'edl');
    expect(edlContent).toContain('\r\n');
    expect(edlContent).toMatch(/^TITLE:\s+Export Suite Session/m);
    expect(edlContent).toMatch(/^FCM:\s+(NON-DROP FRAME|DROP FRAME)/m);
    // DaVinci Resolve marker EDL: one-frame event, then ` |C:ResolveColor<Color> |M:<name> |D:1`
    expect(edlContent).toMatch(/^\d{3} {2}001 {6}V {5}C {8}\d\d:\d\d:\d\d:\d\d /m);
    expect(edlContent).toMatch(/^ \|C:ResolveColor(Red|Fuchsia|Yellow|Blue) \|M:.+ \|D:1\r$/m);
    // Each category keeps its own color (Kill red, Wipe fuchsia, Clutch yellow, Note blue), in marking order
    const colors = [...edlContent.matchAll(/^ \|C:ResolveColor(\w+) /gm)].map((m) => m[1]);
    expect(colors).toEqual(['Red', 'Fuchsia', 'Yellow', 'Blue']);

    // 2. Final Cut Pro XML
    const xmlContent = await downloadFormat('Premiere Pro', 'xml');
    expect(xmlContent).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xmlContent).toContain('<xmeml version="4">');
    expect(xmlContent).toMatch(/<sequence id=/);
    // Parse with DOMParser to verify strict XML compliance
    const xmlErrors: string[] = [];
    const doc = new DOMParser({
      onError: (level, msg) => {
        if (level === 'error' || level === 'fatalError') {
          xmlErrors.push(`[${level}] ${msg}`);
        }
      },
    }).parseFromString(xmlContent, 'text/xml');
    expect(xmlErrors).toEqual([]);
    const markers = doc.getElementsByTagName('marker');
    expect(markers.length).toBeGreaterThanOrEqual(4);

    // 3. CSV
    const csvContent = await downloadFormat('Universal CSV', 'csv');
    const csvLines = csvContent.split(/\r?\n/).filter(Boolean);
    expect(csvLines[0]).toBe(
      'Marker ID,Timestamp (UTC),Timecode,Frame,Relative Time (ms),Category,Creator,Label,Comment,Color,Session ID'
    );
    expect(csvLines.length).toBeGreaterThanOrEqual(5); // header + 4 markers

    // 4. YouTube Chapters (.txt - enforces 10s minimum chapter spacing)
    const txtContent = await downloadFormat('YouTube Chapters', 'txt');
    const txtLines = txtContent.split(/\r?\n/).filter(Boolean);
    expect(txtLines.length).toBeGreaterThanOrEqual(1);
    // YouTube chapters must start with 00:00
    expect(txtLines[0]).toMatch(/^00:00\s+/);

    // 5. Sync Matrix (JSON)
    const jsonContent = await downloadFormat('Multicam Matrix', 'json');
    const parsedMatrix = JSON.parse(jsonContent);
    expect(parsedMatrix).toHaveProperty('roomId');
    expect(parsedMatrix).toHaveProperty('sessionId');
    expect(parsedMatrix).toHaveProperty('markers');
    expect(Array.isArray(parsedMatrix.markers)).toBe(true);
    expect(parsedMatrix.markers.length).toBe(4);
  });
});

test.describe('Narrow OBS dock viewport layouts (Spanish locale)', () => {
  test('360 px width: all controls stay fully on-screen without horizontal scroll or clipping', async ({
    browser,
    request,
  }) => {
    const room = await createRoom(request, 'Narrow 360');
    const context = await newIdentity(browser);
    const dock = await context.newPage();

    await dock.setViewportSize({ width: 360, height: 700 });
    await dock.goto(`/?view=dock&room=${room.id}&lang=es`);
    await expect(dock.getByText('0 marcadores registrados')).toBeVisible();

    // No horizontal scrollbar
    const scrollWidth = await dock.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);

    // No interactive elements positioned off-screen
    const offscreen = await dock.evaluate(() =>
      [...document.querySelectorAll('button, input, select')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
        })
        .map((el) => el.textContent?.trim() || el.getAttribute('placeholder') || el.tagName)
    );
    expect(offscreen).toEqual([]);

    // Category buttons 1..5 are all visible and have positive width
    for (const key of ['1', '2', '3', '4', '5']) {
      const btn = dock.locator('button', { hasText: key });
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(20);
      expect(box!.x + box!.width).toBeLessThanOrEqual(361);
    }
  });

  test('300 px width: ultra-narrow dock maintains layout integrity and responsive control access', async ({
    browser,
    request,
  }) => {
    const room = await createRoom(request, 'Narrow 300');
    const context = await newIdentity(browser);
    const dock = await context.newPage();

    await dock.setViewportSize({ width: 300, height: 700 });
    await dock.goto(`/?view=dock&room=${room.id}&lang=es`);
    await expect(dock.getByText('0 marcadores registrados')).toBeVisible();

    // Verify document does not suffer from horizontal overflow blowout
    const scrollWidth = await dock.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(300);

    // Hotkey marker buttons remain operational at 300px
    await dock.keyboard.press('1');
    await expect(dock.getByText('Kill confirmada')).toBeVisible();
    await expect(dock.getByText('1 marcadores registrados')).toBeVisible();

    // Undo button remains visible and operational
    const undoBtn = dock.getByRole('button', { name: 'Deshacer' });
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect(dock.getByText('0 marcadores registrados')).toBeVisible();
  });
});
