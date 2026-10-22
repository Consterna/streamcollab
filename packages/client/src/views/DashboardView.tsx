import React, { useEffect, useState } from 'react';
import { MarkerChanges, Room, RecordingSession, SessionSummary, SquadMarker } from '@streamcollab/shared';
import { StreamCollabSocketClient } from '../services/socket';
import { ExportModal } from '../components/ExportModal';
import { RoomSetupPanel } from '../components/RoomSetupPanel';
import { MarkerRow } from '../components/MarkerRow';
import { SessionHistory } from '../components/SessionHistory';
import { apiUrl } from '../services/serverUrl';
import { deleteSession } from '../services/api';
import { useT, MessageKey, TranslateParams } from '../i18n';
import { Play, Square, Users, Film, Download, Radio, Search, Layers } from 'lucide-react';

interface DashboardViewProps {
  socketClient: StreamCollabSocketClient;
  roomId: string;
  room: Room | null;
  activeSession: RecordingSession | null;
  lastSession?: RecordingSession | null;
  markers: SquadMarker[];
  isHost: boolean;
  onRoomChange: (newRoomId: string) => void;
}

/** "3m ago" style relative time for offline members */
function formatAgo(timestamp: number, t: (key: MessageKey, params?: TranslateParams) => string): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t('dash.ago.now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('dash.ago.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 48 ? t('dash.ago.hours', { n: hours }) : t('dash.ago.days', { n: Math.round(hours / 24) });
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  socketClient,
  roomId,
  room,
  activeSession,
  lastSession,
  markers,
  isHost,
  onRoomChange,
}) => {
  const { t } = useT();
  const liveSession = activeSession || lastSession || null;

  // Session history: null = follow the current session; otherwise browse a past one
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ sessionId: string; markers: SquadMarker[] } | null>(null);
  const viewingHistory = Boolean(selectedSessionId && selectedSessionId !== liveSession?.id);

  // Refresh the list when sessions start / stop / are deleted or marker counts change
  const [deletedSessions, setDeletedSessions] = useState(0);
  const sessionsKey = `${room?.id}|${activeSession?.id}|${lastSession?.stoppedAt}|${markers.length}|${deletedSessions}`;
  useEffect(() => {
    if (!room?.id) return;
    const controller = new AbortController();
    fetch(apiUrl(`/api/rooms/${encodeURIComponent(room.id)}/sessions`), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: SessionSummary[]) => setSessions(list))
      .catch(() => {
        // keep the previous list (network hiccup or aborted)
      });
    return () => controller.abort();
  }, [sessionsKey, room?.id]);

  // Markers of a past session come from the REST API, then follow live edits / deletions
  useEffect(() => {
    if (!viewingHistory || !selectedSessionId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ sessionId: selectedSessionId });
    fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/markers?${params}`), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: SquadMarker[]) => setHistory({ sessionId: selectedSessionId, markers: list }))
      .catch(() => {
        // aborted or offline: keep what is shown
      });
    return () => controller.abort();
  }, [viewingHistory, selectedSessionId, roomId]);

  useEffect(() => {
    const offUpdated = socketClient.on('onMarkerUpdated', (marker) =>
      setHistory((prev) =>
        prev && prev.sessionId === marker.sessionId
          ? { ...prev, markers: prev.markers.map((m) => (m.id === marker.id ? marker : m)) }
          : prev
      )
    );
    const offDeleted = socketClient.on('onMarkerDeleted', ({ markerId, sessionId }) =>
      setHistory((prev) =>
        prev && prev.sessionId === sessionId
          ? { ...prev, markers: prev.markers.filter((m) => m.id !== markerId) }
          : prev
      )
    );
    const offSessionDeleted = socketClient.on('onSessionDeleted', (sessionId) => {
      setDeletedSessions((n) => n + 1);
      setSelectedSessionId((current) => (current === sessionId ? null : current));
    });
    return () => {
      offUpdated();
      offDeleted();
      offSessionDeleted();
    };
  }, [socketClient]);

  const handleDeleteSession = async (session: SessionSummary) => {
    if (!window.confirm(t('dash.deleteSessionConfirm', { name: session.name, count: session.markerCount }))) {
      return;
    }
    try {
      await deleteSession(roomId, session.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t('dash.deleteSessionFailed'));
    }
  };

  const viewedSession: RecordingSession | null = viewingHistory
    ? (sessions.find((session) => session.id === selectedSessionId) ?? null)
    : liveSession;
  const viewedMarkers = viewingHistory ? (history?.sessionId === selectedSessionId ? history.markers : []) : markers;

  const handleSaveMarker = (markerId: string, changes: MarkerChanges) => {
    socketClient.updateMarker(markerId, changes);
  };

  const handleDeleteMarker = (marker: SquadMarker) => {
    if (
      window.confirm(
        t('dash.deleteMarkerConfirm', { label: marker.label, timecode: marker.timecode, member: marker.memberName })
      )
    ) {
      socketClient.deleteMarker(marker.id);
    }
  };
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Start session form state
  const [showStartModal, setShowStartModal] = useState(false);
  const [sessionName, setSessionName] = useState(() => t('dash.defaultSessionName'));
  const [baseTimecode, setBaseTimecode] = useState('01:00:00:00');
  const [selectedFramerate, setSelectedFramerate] = useState('60');
  const [isDropFrame, setIsDropFrame] = useState(false);
  // Drop-frame timecode only exists for the NTSC rates; the server rejects it for any other
  const dropFrameAvailable = selectedFramerate === '59.94' || selectedFramerate === '29.97';

  const handleStartSession = (e: React.FormEvent) => {
    e.preventDefault();
    const framerates: Record<string, { num: number; den: number }> = {
      '60': { num: 60, den: 1 },
      '59.94': { num: 60000, den: 1001 },
      '50': { num: 50, den: 1 },
      '30': { num: 30, den: 1 },
      '29.97': { num: 30000, den: 1001 },
      '25': { num: 25, den: 1 },
      '24': { num: 24, den: 1 },
      '23.976': { num: 24000, den: 1001 },
    };

    const rate = framerates[selectedFramerate] || { num: 60, den: 1 };
    socketClient.startSession(roomId, {
      name: sessionName,
      baseTimecode,
      framerateNumerator: rate.num,
      framerateDenominator: rate.den,
      dropFrame: dropFrameAvailable && isDropFrame,
    });
    setShowStartModal(false);
  };

  const handleStopSession = () => {
    if (!activeSession) return;
    if (window.confirm(t('dash.stopConfirm', { name: activeSession.name }))) {
      socketClient.stopSession(roomId, activeSession.id);
    }
  };

  // Filter markers
  const filteredMarkers = viewedMarkers.filter((m) => {
    const matchCat = filterCategory === 'all' || m.category === filterCategory;
    const matchSearch =
      searchQuery === '' ||
      m.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.comment && m.comment.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCat && matchSearch;
  });

  // Online docks first, then offline members by most recently seen
  const members = [...(room?.members || [])].sort(
    (a, b) => Number(b.online !== false) - Number(a.online !== false) || b.lastHeartbeat - a.lastHeartbeat
  );

  const handleRemoveMember = (memberId: string, name: string) => {
    if (window.confirm(t('dash.removeConfirm', { name }))) {
      socketClient.removeMember(memberId);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans select-none">
      {/* Top Navbar */}
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              {t('dash.title')}
              <span className="rounded-sm bg-indigo-500/20 px-2 py-0.5 text-xs font-mono text-indigo-400 border border-indigo-500/30">
                {t('dash.room', { name: room?.name || roomId })}
              </span>
            </h1>
            <p className="text-xs text-zinc-400">{t('dash.subtitle')}</p>
          </div>
        </div>

        {/* Master Recording Controls */}
        <div className="flex items-center gap-3">
          {activeSession ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-1.5 border border-red-500/30 text-xs">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-bold text-red-400">{activeSession.name}</span>
                <span className="text-zinc-500">|</span>
                <span className="font-mono text-zinc-300">
                  {activeSession.framerateNumerator}/{activeSession.framerateDenominator} fps
                </span>
              </div>
              <button
                onClick={handleStopSession}
                disabled={!isHost}
                title={isHost ? undefined : t('dash.onlyHostStop')}
                className="disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-500 shadow-lg shadow-red-600/20 transition"
              >
                <Square className="h-4 w-4" />
                {t('dash.stopSession')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowStartModal(true)}
              disabled={!isHost || !room}
              title={isHost ? undefined : t('dash.onlyHostStart')}
              className="disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 transition"
            >
              <Play className="h-4 w-4" />
              {t('dash.startSession')}
            </button>
          )}

          <button
            onClick={() => setIsExportOpen(true)}
            disabled={!viewedSession}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-lg shadow-indigo-600/20"
          >
            <Download className="h-4 w-4" />
            {t('dash.exportTimeline')}
          </button>
        </div>
      </header>

      <RoomSetupPanel
        socketClient={socketClient}
        roomId={roomId}
        room={room}
        isHost={isHost}
        onRoomChange={onRoomChange}
      />

      {/* Main Content Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        {/* Left 2 Cols: Squad Health Matrix & Active Sessions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Squad Member Health Matrix */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-white">{t('dash.squadMatrix')}</h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                  {t('dash.creators', { count: members.length })}
                </span>
              </div>
            </div>

            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-zinc-500 text-xs">
                <Users className="h-8 w-8 text-zinc-700 mb-2" />
                <p>{t('dash.noMembers')}</p>
                <p className="text-[11px] text-zinc-600 mt-1">{t('dash.noMembersHint')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] font-semibold text-zinc-400">
                      <th className="pb-2">{t('dash.col.creator')}</th>
                      <th className="pb-2">{t('dash.col.role')}</th>
                      <th className="pb-2">{t('dash.col.status')}</th>
                      <th className="pb-2">{t('dash.col.duration')}</th>
                      <th className="pb-2">{t('dash.col.fps')}</th>
                      <th className="pb-2">{t('dash.col.offset')}</th>
                      <th className="pb-2">{t('dash.col.rtt')}</th>
                      {isHost && <th className="pb-2" aria-label={t('dash.col.actions')} />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {members.map((m) => {
                      const isRec = m.obsStatus === 'recording';
                      const isPaused = m.obsStatus === 'paused';
                      const isOffline = m.online === false;

                      return (
                        <tr key={m.id} className="hover:bg-zinc-800/40 transition">
                          <td className="py-2.5 font-sans font-semibold text-white flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-950 text-indigo-300 text-[10px] font-bold border border-indigo-700/50">
                              {m.name.slice(0, 2).toUpperCase()}
                            </div>
                            {m.name}
                          </td>
                          <td className="py-2.5 font-sans text-zinc-400">{t(`dash.role.${m.role}`)}</td>
                          <td className="py-2.5 font-sans">
                            {isOffline ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-500 border border-zinc-800"
                                title={m.lastHeartbeat ? new Date(m.lastHeartbeat).toLocaleString() : undefined}
                              >
                                {t('dash.status.offline')}
                                {m.lastHeartbeat ? ` · ${formatAgo(m.lastHeartbeat, t)}` : ''}
                              </span>
                            ) : isRec ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                                {t('dash.status.recording')}
                              </span>
                            ) : isPaused ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/30">
                                {t('dash.status.paused')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                                {t('dash.status.idle')}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-zinc-200">
                            {Math.floor(m.outputDurationMs / 60000)}m {Math.floor((m.outputDurationMs % 60000) / 1000)}s
                          </td>
                          <td className="py-2.5 text-zinc-300">{m.fps || 60} fps</td>
                          <td className="py-2.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                Math.abs(m.clockOffsetMs) < 15
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                                  : 'bg-amber-950 text-amber-400 border border-amber-800/50'
                              }`}
                            >
                              {m.clockOffsetMs > 0 ? `+${m.clockOffsetMs.toFixed(1)}` : m.clockOffsetMs.toFixed(1)}ms
                            </span>
                          </td>
                          <td className="py-2.5 text-zinc-400">{m.rttMs.toFixed(1)}ms</td>
                          {isHost && (
                            <td className="py-2.5 text-right font-sans">
                              {isOffline && (
                                <button
                                  onClick={() => handleRemoveMember(m.id, m.name)}
                                  className="rounded-sm px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                                  title={t('dash.removeTitle')}
                                >
                                  {t('dash.remove')}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Master Timeline StreamCollab Markers */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800 pb-3 mb-4 gap-3">
              <div className="flex items-center gap-2">
                <Film className="h-5 w-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-white">
                  {viewingHistory
                    ? t('dash.sessionTimeline', { name: viewedSession?.name ?? '' })
                    : t('dash.liveTimeline')}
                </h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                  {t('dash.countOf', { shown: filteredMarkers.length, total: viewedMarkers.length })}
                </span>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('dash.search')}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-hidden w-40 sm:w-48"
                  />
                </div>

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
                >
                  <option value="all">{t('dash.filter.all')}</option>
                  <option value="kill">{t('dash.filter.kill')}</option>
                  <option value="wipe">{t('dash.filter.wipe')}</option>
                  <option value="clutch">{t('dash.filter.clutch')}</option>
                  <option value="funny">{t('dash.filter.funny')}</option>
                  <option value="note">{t('dash.filter.note')}</option>
                  <option value="custom">{t('dash.filter.custom')}</option>
                </select>
              </div>
            </div>

            {filteredMarkers.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs">{t('dash.noMatches')}</div>
            ) : (
              <div className="divide-y divide-zinc-800/80 max-h-96 overflow-y-auto">
                {filteredMarkers.map((m) => (
                  <MarkerRow
                    key={m.id}
                    marker={m}
                    canEdit={isHost}
                    onSave={handleSaveMarker}
                    onDelete={handleDeleteMarker}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Session Information & Direct Export Suite */}
        <div className="space-y-6">
          <SessionHistory
            sessions={sessions}
            viewedSessionId={selectedSessionId}
            liveSessionId={liveSession?.id ?? null}
            onSelect={setSelectedSessionId}
            onDelete={isHost ? handleDeleteSession : undefined}
          />

          {/* Session Overview Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-400" />
                <span>{t('dash.details')}</span>
              </div>
              {viewedSession && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    !viewedSession.stoppedAt
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
                      : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                  }`}
                >
                  {!viewedSession.stoppedAt ? t('dash.liveRecording') : t('dash.completed')}
                </span>
              )}
            </h2>

            {viewedSession ? (
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-zinc-500 block text-[11px]">{t('dash.sessionName')}</span>
                  <span className="font-semibold text-white">{viewedSession.name}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">{t('dash.framerate')}</span>
                  <span className="font-mono text-zinc-200">
                    {viewedSession.framerateNumerator}/{viewedSession.framerateDenominator} fps
                    {viewedSession.dropFrame ? t('dash.dropFrame') : t('dash.nonDropFrame')}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">{t('dash.baseTimecode')}</span>
                  <span className="font-mono text-zinc-200">{viewedSession.baseTimecode}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">{t('dash.startedAt')}</span>
                  <span className="text-zinc-300">{new Date(viewedSession.startedAt).toLocaleString()}</span>
                </div>
                {viewedSession.stoppedAt && (
                  <div>
                    <span className="text-zinc-500 block text-[11px]">{t('dash.duration')}</span>
                    <span className="text-zinc-300 font-mono">
                      {Math.floor((viewedSession.stoppedAt - viewedSession.startedAt) / 60000)}m{' '}
                      {Math.floor(((viewedSession.stoppedAt - viewedSession.startedAt) % 60000) / 1000)}s
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">{t('dash.noActiveSession')}</div>
            )}
          </div>

          {/* Quick Exporters Box */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 border-b border-zinc-800 pb-3 mb-3">
              <Download className="h-4 w-4 text-indigo-400" />
              {t('dash.quickDownloads')}
            </h2>
            <div className="space-y-2">
              <a
                href={viewedSession ? apiUrl(`/api/rooms/${roomId}/export/edl?sessionId=${viewedSession.id}`) : '#'}
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !viewedSession ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">{t('dash.dl.edl')}</span>
                <span className="font-mono text-[10px] text-zinc-500">.edl</span>
              </a>

              <a
                href={viewedSession ? apiUrl(`/api/rooms/${roomId}/export/xml?sessionId=${viewedSession.id}`) : '#'}
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !viewedSession ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">{t('dash.dl.xml')}</span>
                <span className="font-mono text-[10px] text-zinc-500">.xml</span>
              </a>

              <a
                href={viewedSession ? apiUrl(`/api/rooms/${roomId}/export/csv?sessionId=${viewedSession.id}`) : '#'}
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !viewedSession ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">{t('dash.dl.csv')}</span>
                <span className="font-mono text-[10px] text-zinc-500">.csv</span>
              </a>

              <a
                href={viewedSession ? apiUrl(`/api/rooms/${roomId}/export/youtube?sessionId=${viewedSession.id}`) : '#'}
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !viewedSession ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">{t('dash.dl.youtube')}</span>
                <span className="font-mono text-[10px] text-zinc-500">.txt</span>
              </a>

              <a
                href={viewedSession ? apiUrl(`/api/rooms/${roomId}/export/matrix?sessionId=${viewedSession.id}`) : '#'}
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !viewedSession ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">{t('dash.dl.matrix')}</span>
                <span className="font-mono text-[10px] text-zinc-500">.json</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Start Session Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <form
            onSubmit={handleStartSession}
            className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-400" />
              {t('dash.configure')}
            </h3>

            <div>
              <label htmlFor="sessionName" className="text-xs font-semibold text-zinc-400 block mb-1">
                {t('dash.form.name')}
              </label>
              <input
                id="sessionName"
                type="text"
                required
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="w-full rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label htmlFor="sessionFramerate" className="text-xs font-semibold text-zinc-400 block mb-1">
                {t('dash.form.framerate')}
              </label>
              <select
                id="sessionFramerate"
                value={selectedFramerate}
                onChange={(e) => {
                  setSelectedFramerate(e.target.value);
                  if (e.target.value === '59.94' || e.target.value === '29.97') {
                    setIsDropFrame(true);
                  } else {
                    setIsDropFrame(false);
                  }
                }}
                className="w-full rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-hidden"
              >
                <option value="60">{t('dash.form.fps.60')}</option>
                <option value="59.94">{t('dash.form.fps.59.94')}</option>
                <option value="50">{t('dash.form.fps.50')}</option>
                <option value="30">30 FPS</option>
                <option value="29.97">{t('dash.form.fps.29.97')}</option>
                <option value="25">25 FPS</option>
                <option value="24">{t('dash.form.fps.24')}</option>
                <option value="23.976">23.976 FPS (24000/1001)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="dropFrame"
                checked={dropFrameAvailable && isDropFrame}
                disabled={!dropFrameAvailable}
                title={dropFrameAvailable ? undefined : t('dash.form.dropFrameOnlyNtsc')}
                onChange={(e) => setIsDropFrame(e.target.checked)}
                className="rounded-sm border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-0"
              />
              <label htmlFor="dropFrame" className="text-xs text-zinc-300">
                {t('dash.form.dropFrame')}
              </label>
            </div>

            <div>
              <label htmlFor="sessionBaseTimecode" className="text-xs font-semibold text-zinc-400 block mb-1">
                {t('dash.form.baseTimecode')}
              </label>
              <input
                id="sessionBaseTimecode"
                type="text"
                required
                value={baseTimecode}
                onChange={(e) => setBaseTimecode(e.target.value)}
                placeholder="01:00:00:00"
                className="w-full rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-white focus:border-indigo-500 focus:outline-hidden"
              />
              <p className="text-[10px] text-zinc-500 mt-1">{t('dash.form.baseHint')}</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowStartModal(false)}
                className="rounded-sm px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="rounded-sm bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
              >
                {t('dash.form.start')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        session={viewedSession}
        markers={viewedMarkers}
        members={members}
        roomId={roomId}
      />
    </div>
  );
};
