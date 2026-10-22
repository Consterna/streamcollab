import React, { useState, useEffect, useCallback, useRef, useEffectEvent } from 'react';
import { SquadMarker, SquadMember, RecordingSession, Room, MarkerCategory, SMPTETimecode } from '@streamcollab/shared';
import { ObsService, ObsRecordStatus, ObsVideoSettings, ObsHotkeySignal, ObsChapterSupport } from '../services/obs';
import {
  getBoolPreference,
  setBoolPreference,
  getStringPreference,
  setStringPreference,
} from '../services/preferences';
import { StreamCollabSocketClient } from '../services/socket';
import { getMemberToken } from '../services/credentials';
import { useT } from '../i18n';
import { ExportModal } from '../components/ExportModal';
import {
  Crosshair,
  Skull,
  Trophy,
  Smile,
  FileEdit,
  Radio,
  ChevronDown,
  ChevronUp,
  Download,
  Activity,
  Send,
  Undo2,
  ServerOff,
} from 'lucide-react';

// Default marker labels, shared by the dock buttons, dock hotkeys and global OBS hotkeys
type QuickMarkCategory = 'kill' | 'wipe' | 'clutch' | 'funny' | 'note';
const QUICK_MARK_CATEGORIES: QuickMarkCategory[] = ['kill', 'wipe', 'clutch', 'funny', 'note'];
const isQuickMarkCategory = (value: string): value is QuickMarkCategory =>
  (QUICK_MARK_CATEGORIES as string[]).includes(value);

interface DockViewProps {
  socketClient: StreamCollabSocketClient;
  obsService: ObsService;
  roomId: string;
  member: SquadMember;
  room: Room | null;
  activeSession: RecordingSession | null;
  lastSession?: RecordingSession | null;
  markers: SquadMarker[];
}

export const DockView: React.FC<DockViewProps> = ({
  socketClient,
  obsService,
  roomId,
  member,
  room,
  activeSession,
  lastSession,
  markers,
}) => {
  const { t } = useT();
  // Default marker labels come from the marking streamer's language (they are stored as data)
  const quickLabel = useCallback((category: QuickMarkCategory) => t(`marker.${category}`), [t]);
  const sessionForExport = activeSession || lastSession || null;
  // OBS states
  const [obsConnected, setObsConnected] = useState(obsService.connected);
  // Remembered per OBS profile so the dock reconnects by itself on every OBS start
  const [obsAddress, setObsAddress] = useState(() => getStringPreference('obsAddress', 'ws://127.0.0.1:4455'));
  const [obsPassword, setObsPassword] = useState(() => getStringPreference('obsPassword', ''));
  const [obsRetryMs, setObsRetryMs] = useState<number | null>(null);
  useEffect(() => obsService.on('retry', setObsRetryMs), [obsService]);

  const connectObs = () => {
    setStringPreference('obsAddress', obsAddress);
    setStringPreference('obsPassword', obsPassword);
    void obsService.connect(obsAddress, obsPassword);
  };
  const [showObsSettings, setShowObsSettings] = useState(false);
  const [recordStatus, setRecordStatus] = useState<ObsRecordStatus | null>(null);
  const [videoSettings, setVideoSettings] = useState<ObsVideoSettings | null>(null);

  // Quick mark custom note
  const [customComment, setCustomComment] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MarkerCategory>('kill');
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Status timer
  const [elapsedDurationMs, setElapsedDurationMs] = useState(0);

  // SNTP stats
  const [sntpStats, setSntpStats] = useState({ offset: 0, rtt: 0 });

  // Link to the StreamCollab server: without it markers can't reach the room
  // (a connection still opening counts as connected, so the warning doesn't flash on every load)
  const [serverConnected, setServerConnected] = useState(() => socketClient.connected || socketClient.connecting);
  useEffect(() => socketClient.on('onConnectionChange', setServerConnected), [socketClient]);
  // Shown for a few seconds when a marker could not be sent
  const [markerNotSentAt, setMarkerNotSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (markerNotSentAt === null) return;
    const timeout = setTimeout(() => setMarkerNotSentAt(null), 5000);
    return () => clearTimeout(timeout);
  }, [markerNotSentAt]);

  // Latest OBS video settings / recording anchor for callbacks, without re-subscribing
  // (and re-connecting to OBS) every time they change
  const videoSettingsRef = useRef<ObsVideoSettings | null>(null);
  const recordAnchorRef = useRef<{ startedAt: number | null; paused: boolean }>({ startedAt: null, paused: false });

  // OBS listeners
  useEffect(() => {
    const offStatus = obsService.on('status', (connected) => {
      setObsConnected(connected);
      if (connected) {
        obsService.getVideoSettings().then((settings) => {
          videoSettingsRef.current = settings;
          setVideoSettings(settings);
        });
        obsService.queryRecordStatus();
      }
    });

    const offRecord = obsService.on('record', (status) => {
      setRecordStatus(status);
      setElapsedDurationMs(status.outputDuration);

      // Where this recording file starts on the server clock. Re-anchor after a pause, since
      // paused time is not part of the file and would otherwise shift later markers.
      const anchor = recordAnchorRef.current;
      if (!status.outputActive) {
        anchor.startedAt = null;
      } else if (!status.outputPaused && (anchor.startedAt === null || anchor.paused)) {
        anchor.startedAt = Math.round(socketClient.getCalibratedNow() - status.outputDuration);
      }
      anchor.paused = status.outputActive && status.outputPaused;

      // Report OBS record status to StreamCollab server
      let obsStatus: 'recording' | 'paused' | 'stopped' = 'stopped';
      if (status.outputActive) {
        obsStatus = status.outputPaused ? 'paused' : 'recording';
      }
      const settings = videoSettingsRef.current;
      socketClient.updateStatus(roomId, member.id, {
        obsStatus,
        outputDurationMs: status.outputDuration,
        fps: settings?.fps || 60,
        fpsNumerator: settings?.fpsNumerator,
        fpsDenominator: settings?.fpsDenominator,
        recordStartedAt: anchor.startedAt,
      });
    });

    return () => {
      offStatus();
      offRecord();
    };
  }, [obsService, socketClient, roomId, member.id]);

  // Auto-connect to OBS on load; the service keeps retrying until OBS is running
  useEffect(() => {
    obsService.connect(obsAddress, obsPassword);
    return () => {
      obsService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsService]);

  // Wall clock for the session timecode while OBS isn't recording (ticks only when it is shown)
  const [now, setNow] = useState(() => Date.now());
  const showSessionClock = Boolean(activeSession) && !recordStatus?.outputActive;
  useEffect(() => {
    if (!showSessionClock) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [showSessionClock]);

  // Keep local duration ticking smoothly if recording
  useEffect(() => {
    if (!recordStatus?.outputActive || recordStatus?.outputPaused) return;

    const interval = setInterval(() => {
      setElapsedDurationMs((prev) => prev + 100);
    }, 100);

    return () => clearInterval(interval);
  }, [recordStatus?.outputActive, recordStatus?.outputPaused]);

  // Clock sync callback
  useEffect(
    () =>
      socketClient.on('onClockSync', (offset, rtt) => {
        setSntpStats({ offset: Math.round(offset * 10) / 10, rtt: Math.round(rtt * 10) / 10 });
      }),
    [socketClient]
  );

  // Native OBS recording chapters (Hybrid MP4): written into this streamer's own file
  const [chapterSupport, setChapterSupport] = useState<ObsChapterSupport>(obsService.chapters);
  const [chaptersEnabled, setChaptersEnabled] = useState(() => getBoolPreference('chapters', true));
  const [squadChapters, setSquadChapters] = useState(() => getBoolPreference('squadChapters', false));
  useEffect(() => obsService.on('chapters', setChapterSupport), [obsService]);

  const writeChapter = useCallback(
    (marker: { category: string; label: string; comment?: string; memberName: string }) => {
      if (!chaptersEnabled) return;
      const comment = marker.comment ? ` - ${marker.comment}` : '';
      void obsService.createChapter(
        `${marker.category.toUpperCase()}: ${marker.label}${comment} (${marker.memberName})`
      );
    },
    [obsService, chaptersEnabled]
  );

  // Squadmates' markers can also become chapters in this streamer's file (opt-in)
  const onSquadMarker = useEffectEvent((marker: SquadMarker) => {
    if (squadChapters && marker.memberId !== member.id) {
      writeChapter(marker);
    }
  });
  useEffect(() => socketClient.on('onMarkerAdded', (marker) => onSquadMarker(marker)), [socketClient]);

  // Remove this streamer's last marker (server picks it, so a fast double press can't race)
  const handleUndo = useCallback(() => {
    socketClient.undoLastMarker();
  }, [socketClient]);

  // Trigger quick marker
  const handleQuickMark = useCallback(
    (category: MarkerCategory, defaultLabel: string, commentOverride?: string) => {
      if (!roomId) return;

      const comment = commentOverride !== undefined ? commentOverride : customComment;

      const sent = socketClient.createMarker({
        roomId,
        sessionId: activeSession?.id || '',
        memberId: member.id,
        memberName: member.name,
        category,
        label: defaultLabel,
        comment: comment.trim() || undefined,
        // Exact position inside this streamer's own recording file, for per-POV exports
        obsRecordMs: obsService.getEstimatedRecordMs(),
      });
      if (!sent) setMarkerNotSentAt(Date.now());
      // The chapter still lands in this streamer's own recording file
      writeChapter({ category, label: defaultLabel, comment: comment.trim() || undefined, memberName: member.name });

      if (commentOverride === undefined) {
        setCustomComment('');
      }
    },
    [socketClient, obsService, roomId, activeSession?.id, member.id, member.name, customComment, writeChapter]
  );

  // Global OBS hotkeys (from obs-scripts/streamcollab-hotkeys.lua) work while the game has focus
  // useEffectEvent always sees the latest handleQuickMark without re-subscribing
  const onHotkeySignal = useEffectEvent(({ category }: ObsHotkeySignal) => {
    if (category === 'undo') {
      handleUndo();
      return;
    }
    if (isQuickMarkCategory(category)) {
      handleQuickMark(category, quickLabel(category));
    }
  });
  useEffect(() => obsService.on('hotkey', (signal) => onHotkeySignal(signal)), [obsService]);

  // Dock-focused hotkeys (1: Kill, 2: Wipe, 3: Clutch, 4: Funny, 5: Note, 0 / Ctrl+Z: Undo)
  useEffect(() => {
    const keyToCategory: Record<string, QuickMarkCategory> = {
      '1': 'kill',
      '2': 'wipe',
      '3': 'clutch',
      '4': 'funny',
      '5': 'note',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger while typing or choosing in a form control
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }

      if (e.key === '0' || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        handleUndo();
        return;
      }

      const category = keyToCategory[e.key];
      if (category) {
        e.preventDefault();
        handleQuickMark(category, quickLabel(category));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleQuickMark, handleUndo, quickLabel]);

  // Calculate formatted timecode for display
  const tc = new SMPTETimecode({
    framerateNumerator: activeSession?.framerateNumerator || 60,
    framerateDenominator: activeSession?.framerateDenominator || 1,
    dropFrame: activeSession?.dropFrame || false,
  });

  const displayTimecode = tc.relativeMsToTimecode(
    recordStatus?.outputActive ? elapsedDurationMs : activeSession ? Math.max(0, now - activeSession.startedAt) : 0,
    activeSession?.baseTimecode || '01:00:00:00'
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      {/* Top Header / OBS Status Bar */}
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs">
        {/* OBS Status */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowObsSettings(!showObsSettings)}
            className="flex items-center gap-1.5 rounded-sm bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700 transition"
            title={t('dock.obsSettingsTitle')}
          >
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                obsConnected ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-red-500'
              }`}
            />
            <span className="font-semibold text-[11px]">
              {obsConnected
                ? t('dock.obsLinked')
                : obsRetryMs !== null
                  ? t('dock.obsRetrying')
                  : t('dock.obsDisconnected')}
            </span>
            {showObsSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {!serverConnected && (
            <span
              className="flex items-center gap-1 rounded-sm bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 border border-red-500/40"
              title={t('dock.serverDisconnectedTitle')}
              role="status"
            >
              <ServerOff className="h-3 w-3" />
              {t('dock.serverDisconnected')}
            </span>
          )}

          {videoSettings && (
            <span className="text-[11px] text-zinc-400 font-mono">
              {videoSettings.outputWidth}x{videoSettings.outputHeight} @ {videoSettings.fps}fps
            </span>
          )}
        </div>

        {/* SNTP Sync & Export */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono bg-zinc-950 px-2 py-1 rounded-sm border border-zinc-800/80">
            <Activity className="h-3 w-3 text-indigo-400" />
            <span>RTT: {sntpStats.rtt}ms</span>
            <span className="text-zinc-600">|</span>
            <span>Δ: {sntpStats.offset > 0 ? `+${sntpStats.offset}` : sntpStats.offset}ms</span>
          </div>

          <button
            onClick={() => setIsExportOpen(true)}
            disabled={!sessionForExport}
            className="flex items-center gap-1 rounded-sm bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('dock.exportNle')}</span>
          </button>
        </div>
      </header>

      {/* Collapsible OBS WebSocket Settings */}
      {showObsSettings && (
        <div className="border-b border-zinc-800 bg-zinc-900 p-3 text-xs space-y-2 animate-toast-in">
          <div className="flex items-center gap-2">
            <span className="w-20 text-zinc-400 font-medium">{t('dock.websocket')}</span>
            <input
              type="text"
              value={obsAddress}
              onChange={(e) => setObsAddress(e.target.value)}
              className="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 font-mono text-[11px]"
              placeholder="ws://127.0.0.1:4455"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-zinc-400 font-medium">{t('dock.password')}</span>
            <input
              type="password"
              value={obsPassword}
              onChange={(e) => setObsPassword(e.target.value)}
              className="flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 font-mono text-[11px]"
              placeholder={t('dock.passwordPlaceholder')}
            />
            <button
              onClick={() => {
                if (obsConnected) {
                  void obsService.disconnect();
                } else {
                  connectObs();
                }
              }}
              className="rounded-sm bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 transition"
            >
              {obsConnected ? t('dock.disconnect') : obsRetryMs !== null ? t('dock.retryNow') : t('dock.connect')}
            </button>
          </div>
          <p className="pl-22 text-[10px] text-zinc-500">
            {t('dock.savedHint')}
            {obsRetryMs !== null ? t('dock.nextTry', { seconds: Math.round(obsRetryMs / 1000) }) : ''}.
          </p>
          <div className="flex items-start gap-2">
            <span className="w-20 text-zinc-400 font-medium">{t('dock.chapters')}</span>
            <div className="flex-1 space-y-1">
              <div className="text-[11px]">
                {chapterSupport.state === 'unknown' && (
                  <span className="text-zinc-500">{t('dock.chaptersUnknown')}</span>
                )}
                {chapterSupport.state === 'unsupported' && (
                  <span className="text-amber-400">
                    {t('dock.chaptersUnsupported')}
                    {chapterSupport.obsVersion ? t('dock.chaptersYouHave', { version: chapterSupport.obsVersion }) : ''}
                  </span>
                )}
                {chapterSupport.state === 'available' && !chapterSupport.lastError && (
                  <span className="text-emerald-400">{t('dock.chaptersAvailable')}</span>
                )}
                {chapterSupport.state === 'available' && chapterSupport.lastError && (
                  <span className="text-amber-400">{t('dock.chaptersRejected')}</span>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={chaptersEnabled}
                  onChange={(e) => {
                    setChaptersEnabled(e.target.checked);
                    setBoolPreference('chapters', e.target.checked);
                  }}
                />
                {t('dock.chaptersMine')}
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={squadChapters}
                  disabled={!chaptersEnabled}
                  onChange={(e) => {
                    setSquadChapters(e.target.checked);
                    setBoolPreference('squadChapters', e.target.checked);
                  }}
                />
                {t('dock.chaptersSquad')}
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-zinc-400 font-medium">{t('dock.httpToken')}</span>
            <span className="flex-1 text-[11px] text-zinc-500">
              {t('dock.httpTokenHint', { room: roomId })} <span className="font-mono">{member.id}</span>
            </span>
            <button
              onClick={async () => {
                const token = getMemberToken(member.id);
                if (!token) return;
                try {
                  await navigator.clipboard.writeText(token);
                } catch {
                  window.prompt(t('dock.memberTokenPrompt'), token);
                }
              }}
              disabled={!getMemberToken(member.id)}
              className="rounded-sm border border-zinc-700 bg-zinc-800 px-3 py-1 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition"
            >
              {t('common.copy')}
            </button>
          </div>
        </div>
      )}

      {/* Recording Status & SMPTE Master Timecode Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-linear-to-r from-zinc-900 via-zinc-950 to-zinc-900 px-4 py-3">
        <div className="flex items-center gap-3">
          {recordStatus?.outputActive ? (
            recordStatus.outputPaused ? (
              <div className="flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-amber-400 border border-amber-500/40">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="text-xs font-bold tracking-wider">{t('dock.paused')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-red-400 border border-red-500/40 animate-pulse">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-xs font-bold tracking-wider">{t('dock.recLive')}</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1 text-zinc-400 border border-zinc-700">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />
              <span className="text-xs font-bold tracking-wider">{t('dock.standby')}</span>
            </div>
          )}

          <div className="flex flex-col">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">{t('dock.smpte')}</span>
            <span className="font-mono text-xl font-bold tracking-tight text-white">{displayTimecode}</span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] text-zinc-400 font-medium">
            {t('dock.session', {
              name:
                activeSession?.name ||
                (lastSession ? t('dock.sessionEnded', { name: lastSession.name }) : t('dock.noSession')),
            })}
          </div>
          <div className="text-[11px] text-indigo-400 font-semibold">
            {t('dock.markersCaptured', { count: markers.length })}
          </div>
        </div>
      </div>

      {/* Quick Marker Action Grid (Hotkeys 1..5) */}
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="grid grid-cols-5 gap-2">
          {/* 1. Kill */}
          <button
            onClick={() => handleQuickMark('kill', quickLabel('kill'))}
            className="flex flex-col items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300 hover:bg-red-500/20 hover:border-red-500 active:scale-95 transition"
            title={t('dock.pressToMark', { key: '1', label: t('category.kill') })}
          >
            <div className="flex items-center gap-1 mb-1">
              <Crosshair className="h-4 w-4 text-red-400" />
              <span className="rounded-sm bg-red-950 px-1 text-[9px] font-mono text-red-200 border border-red-800/60">
                1
              </span>
            </div>
            <span className="text-xs font-bold">{t('category.kill')}</span>
          </button>

          {/* 2. Squad Wipe */}
          <button
            onClick={() => handleQuickMark('wipe', quickLabel('wipe'))}
            className="flex flex-col items-center justify-center rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-2 text-fuchsia-300 hover:bg-fuchsia-500/20 hover:border-fuchsia-500 active:scale-95 transition"
            title={t('dock.pressToMark', { key: '2', label: t('category.wipe') })}
          >
            <div className="flex items-center gap-1 mb-1">
              <Skull className="h-4 w-4 text-fuchsia-400" />
              <span className="rounded-sm bg-fuchsia-950 px-1 text-[9px] font-mono text-fuchsia-200 border border-fuchsia-800/60">
                2
              </span>
            </div>
            <span className="text-xs font-bold">{t('category.wipe')}</span>
          </button>

          {/* 3. Clutch */}
          <button
            onClick={() => handleQuickMark('clutch', quickLabel('clutch'))}
            className="flex flex-col items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500 active:scale-95 transition"
            title={t('dock.pressToMark', { key: '3', label: t('category.clutch') })}
          >
            <div className="flex items-center gap-1 mb-1">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span className="rounded-sm bg-amber-950 px-1 text-[9px] font-mono text-amber-200 border border-amber-800/60">
                3
              </span>
            </div>
            <span className="text-xs font-bold">{t('category.clutch')}</span>
          </button>

          {/* 4. Funny */}
          <button
            onClick={() => handleQuickMark('funny', quickLabel('funny'))}
            className="flex flex-col items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500 active:scale-95 transition"
            title={t('dock.pressToMark', { key: '4', label: t('category.funny') })}
          >
            <div className="flex items-center gap-1 mb-1">
              <Smile className="h-4 w-4 text-cyan-400" />
              <span className="rounded-sm bg-cyan-950 px-1 text-[9px] font-mono text-cyan-200 border border-cyan-800/60">
                4
              </span>
            </div>
            <span className="text-xs font-bold">{t('category.funny')}</span>
          </button>

          {/* 5. Note */}
          <button
            onClick={() => handleQuickMark('note', quickLabel('note'))}
            className="flex flex-col items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/10 p-2 text-blue-300 hover:bg-blue-500/20 hover:border-blue-500 active:scale-95 transition"
            title={t('dock.pressToMark', { key: '5', label: t('category.note') })}
          >
            <div className="flex items-center gap-1 mb-1">
              <FileEdit className="h-4 w-4 text-blue-400" />
              <span className="rounded-sm bg-blue-950 px-1 text-[9px] font-mono text-blue-200 border border-blue-800/60">
                5
              </span>
            </div>
            <span className="text-xs font-bold">{t('category.note')}</span>
          </button>
        </div>

        {markerNotSentAt !== null && (
          <p
            role="alert"
            className="mt-2 rounded-sm bg-red-500/15 px-2 py-1 text-[11px] text-red-300 border border-red-500/40"
          >
            {t('dock.markerNotSent')}
          </p>
        )}

        {/* Custom Comment Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customComment.trim()) {
              handleQuickMark(selectedCategory, customComment.trim());
            }
          }}
          className="mt-2.5 flex flex-wrap items-center gap-2"
        >
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as MarkerCategory)}
            className="rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
          >
            <option value="kill">{t('dock.categoryOption.kill')}</option>
            <option value="wipe">{t('dock.categoryOption.wipe')}</option>
            <option value="clutch">{t('dock.categoryOption.clutch')}</option>
            <option value="funny">{t('dock.categoryOption.funny')}</option>
            <option value="note">{t('dock.categoryOption.note')}</option>
            <option value="custom">{t('dock.categoryOption.custom')}</option>
          </select>

          <input
            type="text"
            value={customComment}
            onChange={(e) => setCustomComment(e.target.value)}
            placeholder={t('dock.customPlaceholder')}
            className="min-w-40 flex-1 rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-hidden"
          />

          <button
            type="submit"
            disabled={!customComment.trim()}
            className="flex items-center gap-1 rounded-sm bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-indigo-600 hover:text-white disabled:opacity-40 transition"
          >
            <Send className="h-3.5 w-3.5" />
            <span>{t('dock.mark')}</span>
          </button>

          <button
            type="button"
            onClick={handleUndo}
            disabled={!markers.some((m) => m.memberId === member.id)}
            title={t('dock.undoTitle')}
            className="flex items-center gap-1 rounded-sm bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>{t('dock.undo')}</span>
          </button>
        </form>
      </div>

      {/* Real-time Marker History List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-zinc-400 border-b border-zinc-800/60">
          <span>{t('dock.eventHeader')}</span>
          <span>{t('dock.creatorHeader')}</span>
        </div>

        {markers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-xs">
            <Radio className="h-8 w-8 text-zinc-700 mb-2 animate-pulse" />
            <p>{t('dock.empty')}</p>
            <p className="text-[11px] text-zinc-600 mt-1">{t('dock.emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-900">
            {[...markers].reverse().map((m) => {
              const categoryColors: Record<string, string> = {
                kill: 'border-l-red-500 text-red-400 bg-red-500/5',
                wipe: 'border-l-fuchsia-500 text-fuchsia-400 bg-fuchsia-500/5',
                clutch: 'border-l-amber-500 text-amber-400 bg-amber-500/5',
                funny: 'border-l-cyan-500 text-cyan-400 bg-cyan-500/5',
                note: 'border-l-blue-500 text-blue-400 bg-blue-500/5',
                custom: 'border-l-emerald-500 text-emerald-400 bg-emerald-500/5',
              };
              const borderClass = categoryColors[m.category] || 'border-l-indigo-500 text-indigo-400 bg-indigo-500/5';

              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between border-l-2 p-2 hover:bg-zinc-900/60 transition ${borderClass}`}
                >
                  <div className="flex flex-col pr-2 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-white tracking-tight">{m.timecode}</span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-sm bg-zinc-800/80">
                        {t(`category.${m.category}`)}
                      </span>
                      <span className="text-xs font-medium text-zinc-200 truncate">{m.label}</span>
                    </div>
                    {m.comment && <span className="text-[11px] text-zinc-400 mt-0.5 truncate pl-0.5">{m.comment}</span>}
                  </div>

                  <div className="flex flex-col items-end text-right shrink-0">
                    <span className="text-[11px] font-semibold text-zinc-300">{m.memberName}</span>
                    <span className="text-[10px] font-mono text-zinc-500">+{Math.round(m.relativeTimeMs / 1000)}s</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        session={sessionForExport}
        markers={markers}
        members={room?.members || []}
        roomId={roomId}
      />
    </div>
  );
};
