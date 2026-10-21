import React, { useState } from 'react';
import { Room } from '@streamcollab/shared';
import { Check, Copy, KeyRound, Link as LinkIcon, Plus, ShieldCheck } from 'lucide-react';
import { createRoom, deleteRoom } from '../services/api';
import { getHostToken, saveHostToken } from '../services/credentials';
import { StreamCollabSocketClient } from '../services/socket';
import { viewUrl } from '../services/serverUrl';
import { useT } from '../i18n';

interface RoomSetupPanelProps {
  socketClient: StreamCollabSocketClient;
  roomId: string;
  room: Room | null;
  isHost: boolean;
  onRoomChange: (roomId: string) => void;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt(label, value);
        }
      }}
      className="flex items-center gap-1 rounded-sm border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 transition"
      title={label}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  );
}

/**
 * Room lifecycle for the director: create a room (which makes this browser its host),
 * share the Dock / HUD links, and move host control to another device with the host token.
 */
export const RoomSetupPanel: React.FC<RoomSetupPanelProps> = ({ socketClient, roomId, room, isHost, onRoomChange }) => {
  const { t, locale } = useT();
  const [roomName, setRoomName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostTokenDraft, setHostTokenDraft] = useState('');

  // Invite links keep this panel's language, so the squad's docks and overlays match it
  const dockUrl = viewUrl('dock', roomId, { lang: locale });
  const hudUrl = viewUrl('hud', roomId, { lang: locale });
  const hudSoundUrl = viewUrl('hud', roomId, { lang: locale, sound: '1', volume: '0.6' });
  const hostToken = isHost ? getHostToken(roomId) : undefined;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await createRoom(roomName.trim() || undefined);
      setRoomName('');
      onRoomChange(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('room.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRoom = async () => {
    const answer = window.prompt(t('room.deletePrompt', { room: roomId }));
    if (answer?.trim().toUpperCase() !== roomId.toUpperCase()) return;
    try {
      await deleteRoom(roomId);
      onRoomChange('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('room.deleteFailed'));
    }
  };

  const handleClaimHost = (e: React.FormEvent) => {
    e.preventDefault();
    const token = hostTokenDraft.trim();
    if (!token || !roomId) return;
    saveHostToken(roomId, token);
    setHostTokenDraft('');
    socketClient.rejoin();
  };

  return (
    <section className="mx-6 mt-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs">
      <div className="flex flex-wrap items-start gap-6">
        {/* Create a new room */}
        <form onSubmit={handleCreate} className="flex min-w-[240px] flex-col gap-2">
          <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 text-indigo-400" /> {t('room.new')}
          </span>
          <div className="flex gap-2">
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={t('room.namePlaceholder')}
              maxLength={80}
              className="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-sm bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition"
            >
              {creating ? t('room.creating') : t('room.create')}
            </button>
          </div>
          {error && <span className="text-red-400">{error}</span>}
          <span className="text-zinc-500">{t('room.hostHint')}</span>
        </form>

        {room && (
          <>
            {/* Invite links */}
            <div className="flex min-w-[280px] flex-1 flex-col gap-2">
              <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                <LinkIcon className="h-3.5 w-3.5 text-indigo-400" /> {t('room.invite')}{' '}
                <span className="font-mono text-indigo-300">{roomId}</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="w-24 text-zinc-400">{t('room.dockLink')}</span>
                <code className="flex-1 truncate rounded-sm bg-zinc-950 px-2 py-1 text-zinc-300">{dockUrl}</code>
                <CopyButton value={dockUrl} label={t('room.dockUrl')} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24 text-zinc-400">{t('room.hudLink')}</span>
                <code className="flex-1 truncate rounded-sm bg-zinc-950 px-2 py-1 text-zinc-300">{hudUrl}</code>
                <CopyButton value={hudUrl} label={t('room.hudUrl')} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-24 text-zinc-400">{t('room.hudSoundLink')}</span>
                <code className="flex-1 truncate rounded-sm bg-zinc-950 px-2 py-1 text-zinc-300">{hudSoundUrl}</code>
                <CopyButton value={hudSoundUrl} label={t('room.hudSoundLink')} />
              </div>
            </div>

            {/* Host control */}
            <div className="flex min-w-[240px] flex-col gap-2">
              <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                {isHost ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                )}
                {isHost ? t('room.youAreHost') : t('room.viewingOnly')}
              </span>
              {isHost && hostToken ? (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">{t('room.hostToken')}</span>
                  <CopyButton value={hostToken} label={t('room.hostTokenLabel')} />
                  <button
                    onClick={handleDeleteRoom}
                    className="ml-auto rounded-sm border border-red-900/60 px-2 py-1 text-[11px] text-red-400 hover:bg-red-950/60 transition"
                    title={t('room.deleteTitle')}
                  >
                    {t('room.delete')}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleClaimHost} className="flex gap-2">
                  <input
                    type="password"
                    value={hostTokenDraft}
                    onChange={(e) => setHostTokenDraft(e.target.value)}
                    placeholder={t('room.pasteToken')}
                    className="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-zinc-700 bg-zinc-800 px-3 py-1 text-zinc-200 hover:bg-zinc-700 transition"
                  >
                    {t('room.unlock')}
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
