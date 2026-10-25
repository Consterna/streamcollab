import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { RecordingSession, SquadMarker } from '@streamcollab/shared';
import { LocaleProvider, Locale } from '../src/i18n';
import { MarkerRow } from '../src/components/MarkerRow';
import { ExportModal } from '../src/components/ExportModal';
import { DashboardView } from '../src/views/DashboardView';
import type { StreamCollabSocketClient } from '../src/services/socket';

const session: RecordingSession = {
  id: 'sess-1',
  roomId: 'ROOM-0001',
  name: 'Auto Session 23:07:27',
  startedAt: 1_700_000_000_000,
  stoppedAt: 1_700_000_060_000,
  baseTimecode: '01:00:00:00',
  framerateNumerator: 60,
  framerateDenominator: 1,
  dropFrame: false,
};

const marker: SquadMarker = {
  id: 'mk-1',
  roomId: 'ROOM-0001',
  sessionId: 'sess-1',
  memberId: 'mem-1',
  memberName: 'Shroud',
  timestamp: session.startedAt + 15_000,
  relativeTimeMs: 15_000,
  timecode: '01:00:15:00',
  frameNumber: 900,
  category: 'funny',
  label: 'Ace',
  color: 'Cyan',
};

const inLocale = (locale: Locale, node: React.ReactNode) => (
  <LocaleProvider initialLocale={locale}>{node}</LocaleProvider>
);

describe('MarkerRow', () => {
  it('shows the category in the interface language', async () => {
    const screen = await render(
      inLocale('es', <MarkerRow marker={marker} canEdit={false} onSave={() => {}} onDelete={() => {}} />)
    );
    await expect.element(screen.getByText('Gracioso', { exact: false })).toBeVisible();
    expect(screen.container.textContent).not.toContain('funny');
  });
});

describe('ExportModal', () => {
  const openModal = (onClose = () => {}) =>
    render(
      inLocale(
        'en',
        <ExportModal isOpen onClose={onClose} session={session} markers={[marker]} members={[]} roomId="ROOM-0001" />
      )
    );

  it('moves focus into the dialog and keeps Tab inside it', async () => {
    const screen = await openModal();
    const dialog = screen.getByRole('dialog').element();
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 25; i++) {
      await userEvent.keyboard('{Tab}');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await openModal(onClose);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('survives a clipboard the browser refuses', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const errors: unknown[] = [];
    const onError = (e: PromiseRejectionEvent) => errors.push(e.reason);
    window.addEventListener('unhandledrejection', onError);
    const screen = await openModal();
    await screen.getByRole('button', { name: 'Copy Code' }).click();
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener('unhandledrejection', onError);
    writeText.mockRestore();
    expect(errors).toEqual([]);
    await expect.element(screen.getByRole('button', { name: 'Copy Code' })).toBeVisible();
  });

  it('downloads with a file name Windows accepts', async () => {
    let downloadName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
    const screen = await openModal();
    await screen.getByRole('button', { name: /Download/ }).click();
    click.mockRestore();
    expect(downloadName).toBe('Auto_Session_230727_markers.edl');
  });
});

describe('Director Panel start dialog', () => {
  const fakeSocket = () => {
    const startSession = vi.fn();
    const socket = {
      startSession,
      on: () => () => {},
      stopSession: vi.fn(),
      updateMarker: vi.fn(),
      deleteMarker: vi.fn(),
      removeMember: vi.fn(),
      rejoin: vi.fn(),
    } as unknown as StreamCollabSocketClient;
    return { socket, startSession };
  };

  const room = { id: 'ROOM-0001', name: 'Squad', createdAt: 0, activeSessionId: null, members: [] };

  const openStartDialog = async () => {
    const { socket, startSession } = fakeSocket();
    const screen = await render(
      inLocale(
        'en',
        <DashboardView
          socketClient={socket}
          roomId="ROOM-0001"
          room={room}
          activeSession={null}
          lastSession={null}
          markers={[]}
          isHost
          onRoomChange={() => {}}
        />
      )
    );
    await screen.getByRole('button', { name: 'Start New Session' }).click();
    return { screen, startSession };
  };

  it('keeps the dialog open and sends nothing for an invalid base timecode', async () => {
    const { screen, startSession } = await openStartDialog();
    const base = screen.getByLabelText('Base Starting Timecode');
    await base.fill('1:00:00');
    await screen.getByRole('button', { name: 'Start Recording' }).click();
    expect(startSession).not.toHaveBeenCalled();
    await expect.element(screen.getByRole('dialog')).toBeVisible();
  });

  it('starts the session with a valid base timecode and closes', async () => {
    const { screen, startSession } = await openStartDialog();
    await screen.getByLabelText('Base Starting Timecode').fill('00:00:00:00');
    await screen.getByRole('button', { name: 'Start Recording' }).click();
    expect(startSession).toHaveBeenCalledWith('ROOM-0001', expect.objectContaining({ baseTimecode: '00:00:00:00' }));
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape, moves focus inside and gives it back to the opener', async () => {
    const { screen } = await openStartDialog();
    const dialog = screen.getByRole('dialog').element();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement?.textContent).toContain('Start New Session');
  });

  it('limits the session name to what the server accepts', async () => {
    const { screen } = await openStartDialog();
    const name = screen.getByLabelText('Session Name');
    expect((name.element() as HTMLInputElement).maxLength).toBe(120);
  });
});
