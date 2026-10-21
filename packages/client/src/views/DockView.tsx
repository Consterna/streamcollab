import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  SquadMarker,
  SquadMember,
  RecordingSession,
  Room,
  MarkerCategory,
  SMPTETimecode,
} from '@streamcollab/shared';
import { ObsService, ObsRecordStatus, ObsVideoSettings } from '../services/obs';
import { StreamCollabSocketClient } from '../services/socket';
import { ExportModal } from '../components/ExportModal';
import {
  Crosshair,
  Skull,
  Trophy,
  Smile,
  FileEdit,
  Radio,
  Clock,
  Settings,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
  AlertCircle,
  Activity,
  Send,
} from 'lucide-react';

interface DockViewProps {
  socketClient: StreamCollabSocketClient;
  obsService: ObsService;
  roomId: string;
  member: SquadMember;
  room: Room | null;
  activeSession: RecordingSession | null;
  markers: SquadMarker[];
}

export const DockView: React.FC<DockViewProps> = ({
  socketClient,
  obsService,
  roomId,
  member,
  room,
  activeSession,
  markers,
}) => {
  // OBS states
  const [obsConnected, setObsConnected] = useState(obsService.connected);
  const [obsAddress, setObsAddress] = useState('ws://127.0.0.1:4455');
  const [obsPassword, setObsPassword] = useState('');
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

  // Connect OBS listener
  useEffect(() => {
    obsService.onStatusChange = (connected) => {
      setObsConnected(connected);
      if (connected) {
        obsService.getVideoSettings().then(setVideoSettings);
        obsService.queryRecordStatus().then(setRecordStatus);
      }
    };

    obsService.onRecordChange = (status) => {
      setRecordStatus(status);
      setElapsedDurationMs(status.outputDuration);

      // Report OBS record status to StreamCollab server
      let obsStatus = 'idle';
      if (status.outputActive) {
        obsStatus = status.outputPaused ? 'paused' : 'recording';
      }
      socketClient.updateStatus(roomId, member.id, {
        obsStatus: obsStatus as any,
        outputDurationMs: status.outputDuration,
        fps: videoSettings?.fps || 60,
      });
    };

    // Auto-connect to OBS on load
    obsService.connect(obsAddress, obsPassword);

    return () => {
      obsService.onStatusChange = undefined;
      obsService.onRecordChange = undefined;
    };
  }, [obsService, socketClient, roomId, member.id, videoSettings?.fps]);

  // Keep local duration ticking smoothly if recording
  useEffect(() => {
    if (!recordStatus?.outputActive || recordStatus?.outputPaused) return;

    const interval = setInterval(() => {
      setElapsedDurationMs((prev) => prev + 100);
    }, 100);

    return () => clearInterval(interval);
  }, [recordStatus?.outputActive, recordStatus?.outputPaused]);

  // Clock sync callback
  useEffect(() => {
    socketClient.callbacks.onClockSync = (offset, rtt) => {
      setSntpStats({ offset: Math.round(offset * 10) / 10, rtt: Math.round(rtt * 10) / 10 });
    };
  }, [socketClient]);

  // Trigger quick marker
  const handleQuickMark = useCallback(
    (category: MarkerCategory, defaultLabel: string, commentOverride?: string) => {
      if (!roomId) return;

      const comment = commentOverride !== undefined ? commentOverride : customComment;

      socketClient.createMarker({
        roomId,
        sessionId: activeSession?.id || '',
        memberId: member.id,
        memberName: member.name,
        category,
        label: defaultLabel,
        comment: comment.trim() || undefined,
      });

      if (commentOverride === undefined) {
        setCustomComment('');
      }
    },
    [socketClient, roomId, activeSession?.id, member.id, member.name, customComment]
  );

  // Global hotkeys (1: Kill, 2: Wipe, 3: Clutch, 4: Funny, 5: Note)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.key) {
        case '1':
          e.preventDefault();
          handleQuickMark('kill', 'Kill Confirmed');
          break;
        case '2':
          e.preventDefault();
          handleQuickMark('wipe', 'Squad Wipe');
          break;
        case '3':
          e.preventDefault();
          handleQuickMark('clutch', 'Clutch Play');
          break;
        case '4':
          e.preventDefault();
          handleQuickMark('funny', 'Funny Moment');
          break;
        case '5':
          e.preventDefault();
          handleQuickMark('note', 'Timeline Note');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleQuickMark]);

  // Calculate formatted timecode for display
  const tc = new SMPTETimecode({
    framerateNumerator: activeSession?.framerateNumerator || 60,
    framerateDenominator: activeSession?.framerateDenominator || 1,
    dropFrame: activeSession?.dropFrame || false,
  });

  const displayTimecode = tc.relativeMsToTimecode(
    recordStatus?.outputActive ? elapsedDurationMs : (activeSession ? Math.max(0, Date.now() - activeSession.startedAt) : 0),
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
            className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700 transition"
            title="OBS WebSocket Settings"
          >
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                obsConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-red-500'
              }`}
            />
            <span className="font-semibold text-[11px]">{obsConnected ? 'OBS Linked' : 'OBS Disconnected'}</span>
            {showObsSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {videoSettings && (
            <span className="text-[11px] text-zinc-400 font-mono">
              {videoSettings.outputWidth}x{videoSettings.outputHeight} @ {videoSettings.fps}fps
            </span>
          )}
        </div>

        {/* SNTP Sync & Export */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">
            <Activity className="h-3 w-3 text-indigo-400" />
            <span>RTT: {sntpStats.rtt}ms</span>
            <span className="text-zinc-600">|</span>
            <span>Δ: {sntpStats.offset > 0 ? `+${sntpStats.offset}` : sntpStats.offset}ms</span>
          </div>

          <button
            onClick={() => setIsExportOpen(true)}
            disabled={!activeSession}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-sm"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export NLE</span>
          </button>
        </div>
      </header>

      {/* Collapsible OBS WebSocket Settings */}
      {showObsSettings && (
        <div className="border-b border-zinc-800 bg-zinc-900 p-3 text-xs space-y-2 animate-toast-in">
          <div className="flex items-center gap-2">
            <span className="w-20 text-zinc-400 font-medium">WebSocket:</span>
            <input
              type="text"
              value={obsAddress}
              onChange={(e) => setObsAddress(e.target.value)}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 font-mono text-[11px]"
              placeholder="ws://127.0.0.1:4455"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-zinc-400 font-medium">Password:</span>
            <input
              type="password"
              value={obsPassword}
              onChange={(e) => setObsPassword(e.target.value)}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200 font-mono text-[11px]"
              placeholder="Optional OBS server password"
            />
            <button
              onClick={() => {
                if (obsConnected) {
                  obsService.disconnect();
                } else {
                  obsService.connect(obsAddress, obsPassword);
                }
              }}
              className="rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 transition"
            >
              {obsConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {/* Recording Status & SMPTE Master Timecode Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-950 to-zinc-900 px-4 py-3">
        <div className="flex items-center gap-3">
          {recordStatus?.outputActive ? (
            recordStatus.outputPaused ? (
              <div className="flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-amber-400 border border-amber-500/40">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="text-xs font-bold tracking-wider">PAUSED</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-red-400 border border-red-500/40 animate-pulse">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-xs font-bold tracking-wider">REC LIVE</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1 text-zinc-400 border border-zinc-700">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />
              <span className="text-xs font-bold tracking-wider">STANDBY</span>
            </div>
          )}

          <div className="flex flex-col">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">SMPTE Timecode</span>
            <span className="font-mono text-xl font-bold tracking-tight text-white">{displayTimecode}</span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] text-zinc-400 font-medium">Session: {activeSession?.name || 'No Active Session'}</div>
          <div className="text-[11px] text-indigo-400 font-semibold">{markers.length} markers captured</div>
        </div>
      </div>

      {/* Quick Marker Action Grid (Hotkeys 1..5) */}
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="grid grid-cols-5 gap-2">
          {/* 1. Kill */}
          <button
            onClick={() => handleQuickMark('kill', 'Kill Confirmed')}
            className="flex flex-col items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-red-300 hover:bg-red-500/20 hover:border-red-500 active:scale-95 transition"
            title="Press [1] to mark Kill"
          >
            <div className="flex items-center gap-1 mb-1">
              <Crosshair className="h-4 w-4 text-red-400" />
              <span className="rounded bg-red-950 px-1 text-[9px] font-mono text-red-200 border border-red-800/60">1</span>
            </div>
            <span className="text-xs font-bold">Kill</span>
          </button>

          {/* 2. Squad Wipe */}
          <button
            onClick={() => handleQuickMark('wipe', 'Squad Wipe')}
            className="flex flex-col items-center justify-center rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-2 text-fuchsia-300 hover:bg-fuchsia-500/20 hover:border-fuchsia-500 active:scale-95 transition"
            title="Press [2] to mark Squad Wipe"
          >
            <div className="flex items-center gap-1 mb-1">
              <Skull className="h-4 w-4 text-fuchsia-400" />
              <span className="rounded bg-fuchsia-950 px-1 text-[9px] font-mono text-fuchsia-200 border border-fuchsia-800/60">2</span>
            </div>
            <span className="text-xs font-bold">Wipe</span>
          </button>

          {/* 3. Clutch */}
          <button
            onClick={() => handleQuickMark('clutch', 'Clutch Play')}
            className="flex flex-col items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500 active:scale-95 transition"
            title="Press [3] to mark Clutch"
          >
            <div className="flex items-center gap-1 mb-1">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span className="rounded bg-amber-950 px-1 text-[9px] font-mono text-amber-200 border border-amber-800/60">3</span>
            </div>
            <span className="text-xs font-bold">Clutch</span>
          </button>

          {/* 4. Funny */}
          <button
            onClick={() => handleQuickMark('funny', 'Funny Moment')}
            className="flex flex-col items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500 active:scale-95 transition"
            title="Press [4] to mark Funny Moment"
          >
            <div className="flex items-center gap-1 mb-1">
              <Smile className="h-4 w-4 text-cyan-400" />
              <span className="rounded bg-cyan-950 px-1 text-[9px] font-mono text-cyan-200 border border-cyan-800/60">4</span>
            </div>
            <span className="text-xs font-bold">Funny</span>
          </button>

          {/* 5. Note */}
          <button
            onClick={() => handleQuickMark('note', 'Timeline Note')}
            className="flex flex-col items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/10 p-2 text-blue-300 hover:bg-blue-500/20 hover:border-blue-500 active:scale-95 transition"
            title="Press [5] to mark Note"
          >
            <div className="flex items-center gap-1 mb-1">
              <FileEdit className="h-4 w-4 text-blue-400" />
              <span className="rounded bg-blue-950 px-1 text-[9px] font-mono text-blue-200 border border-blue-800/60">5</span>
            </div>
            <span className="text-xs font-bold">Note</span>
          </button>
        </div>

        {/* Custom Comment Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customComment.trim()) {
              handleQuickMark(selectedCategory, customComment.trim());
            }
          }}
          className="mt-2.5 flex items-center gap-2"
        >
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as MarkerCategory)}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
          >
            <option value="kill">Kill (Red)</option>
            <option value="wipe">Wipe (Fuchsia)</option>
            <option value="clutch">Clutch (Yellow)</option>
            <option value="funny">Funny (Cyan)</option>
            <option value="note">Note (Blue)</option>
            <option value="custom">Custom (Green)</option>
          </select>

          <input
            type="text"
            value={customComment}
            onChange={(e) => setCustomComment(e.target.value)}
            placeholder="Add custom marker label or comment (Enter to mark)..."
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
          />

          <button
            type="submit"
            disabled={!customComment.trim()}
            className="flex items-center gap-1 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-indigo-600 hover:text-white disabled:opacity-40 transition"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Mark</span>
          </button>
        </form>
      </div>

      {/* Real-time Marker History List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-zinc-400 border-b border-zinc-800/60">
          <span>EVENT & TIMECODE</span>
          <span>CREATOR</span>
        </div>

        {markers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-xs">
            <Radio className="h-8 w-8 text-zinc-700 mb-2 animate-pulse" />
            <p>No markers yet in this session.</p>
            <p className="text-[11px] text-zinc-600 mt-1">Press hotkeys [1] - [5] or click buttons above to mark events.</p>
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
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-zinc-800/80">
                        {m.category}
                      </span>
                      <span className="text-xs font-medium text-zinc-200 truncate">{m.label}</span>
                    </div>
                    {m.comment && <span className="text-[11px] text-zinc-400 mt-0.5 truncate pl-0.5">{m.comment}</span>}
                  </div>

                  <div className="flex flex-col items-end text-right shrink-0">
                    <span className="text-[11px] font-semibold text-zinc-300">{m.memberName}</span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      +{Math.round(m.relativeTimeMs / 1000)}s
                    </span>
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
        session={activeSession}
        markers={markers}
        members={room?.members || []}
        roomId={roomId}
      />
    </div>
  );
};
