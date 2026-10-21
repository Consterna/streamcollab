import React, { useState, useEffect, useRef } from 'react';
import {
  SquadMarker,
  SquadMember,
  RecordingSession,
  MarkerCategory,
} from '@streamcollab/shared';
import { StreamCollabSocketClient } from '../services/socket';
import {
  Crosshair,
  Skull,
  Trophy,
  Smile,
  FileEdit,
  Radio,
  Clock,
  Wifi,
  Sparkles,
} from 'lucide-react';

interface ActiveToast {
  id: string;
  marker: SquadMarker;
  expiresAt: number;
}

interface HudViewProps {
  socketClient: StreamCollabSocketClient;
  roomId: string;
  members: SquadMember[];
  activeSession: RecordingSession | null;
}

export const HudView: React.FC<HudViewProps> = ({
  socketClient,
  roomId,
  members,
  activeSession,
}) => {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const [isVisibleInObs, setIsVisibleInObs] = useState(true);

  // OBS Browser Source visibility listener
  useEffect(() => {
    const handleObsVisibility = (event: any) => {
      // OBS fires 'obsSourceVisibleChanged' on the window with detail.visible
      if (typeof event.detail?.visible === 'boolean') {
        setIsVisibleInObs(event.detail.visible);
      }
    };

    window.addEventListener('obsSourceVisibleChanged', handleObsVisibility);
    return () => window.removeEventListener('obsSourceVisibleChanged', handleObsVisibility);
  }, []);

  // Subscribe to new markers
  useEffect(() => {
    // Subscribe alongside App's own marker callback instead of overwriting it
    return socketClient.on('onMarkerAdded', (marker: SquadMarker) => {
      // If OBS source is hidden, skip visual toast animation to save GPU
      if (!isVisibleInObs) return;

      const toastId = `${marker.id}-${Date.now()}`;
      setToasts((prev) => [
        ...prev.slice(-3), // keep maximum 4 toasts on screen
        {
          id: toastId,
          marker,
          expiresAt: Date.now() + 4500, // 4.5 seconds duration
        },
      ]);
    });
  }, [socketClient, isVisibleInObs]);

  // Clean expired toasts
  useEffect(() => {
    if (!isVisibleInObs) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > now));
    }, 200);

    return () => clearInterval(interval);
  }, [isVisibleInObs]);

  const getCategoryTheme = (category: MarkerCategory) => {
    switch (category) {
      case 'kill':
        return {
          icon: Crosshair,
          border: 'border-red-500 shadow-red-500/50',
          bg: 'from-red-950/90 to-zinc-950/90',
          badge: 'bg-red-500 text-white',
          glow: 'text-red-400',
        };
      case 'wipe':
        return {
          icon: Skull,
          border: 'border-fuchsia-500 shadow-fuchsia-500/50',
          bg: 'from-fuchsia-950/90 to-zinc-950/90',
          badge: 'bg-fuchsia-500 text-white',
          glow: 'text-fuchsia-400',
        };
      case 'clutch':
        return {
          icon: Trophy,
          border: 'border-amber-400 shadow-amber-400/50',
          bg: 'from-amber-950/90 to-zinc-950/90',
          badge: 'bg-amber-400 text-black',
          glow: 'text-amber-400',
        };
      case 'funny':
        return {
          icon: Smile,
          border: 'border-cyan-400 shadow-cyan-400/50',
          bg: 'from-cyan-950/90 to-zinc-950/90',
          badge: 'bg-cyan-400 text-black',
          glow: 'text-cyan-400',
        };
      case 'note':
      default:
        return {
          icon: FileEdit,
          border: 'border-blue-500 shadow-blue-500/50',
          bg: 'from-blue-950/90 to-zinc-950/90',
          badge: 'bg-blue-500 text-white',
          glow: 'text-blue-400',
        };
    }
  };

  // Save 100% CEF GPU rendering resources when hidden inside OBS Browser Source
  if (!isVisibleInObs) {
    return null;
  }

  return (
    <div className="relative h-screen w-screen bg-transparent select-none overflow-hidden font-sans p-6">
      {/* Top Right: Animated Marker Toasts */}
      <div className="fixed top-6 right-6 flex flex-col gap-3 pointer-events-none z-50">
        {toasts.map((toast) => {
          const theme = getCategoryTheme(toast.marker.category);
          const Icon = theme.icon;

          return (
            <div
              key={toast.id}
              className={`flex items-center gap-3 rounded-xl border-2 ${theme.border} bg-gradient-to-r ${theme.bg} p-3.5 shadow-2xl backdrop-blur-md animate-toast-in min-w-[320px] max-w-[420px]`}
            >
              {/* Category Icon */}
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${theme.badge} shadow-lg`}>
                <Icon className="h-6 w-6 animate-pulse" />
              </div>

              {/* Toast Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-black uppercase tracking-wider ${theme.glow}`}>
                    {toast.marker.category}
                  </span>
                  <span className="font-mono text-xs font-bold text-zinc-300 bg-black/60 px-1.5 py-0.5 rounded border border-white/10">
                    {toast.marker.timecode}
                  </span>
                </div>

                <div className="text-sm font-bold text-white truncate drop-shadow-sm mt-0.5">
                  {toast.marker.label}
                </div>

                {toast.marker.comment && (
                  <div className="text-xs text-zinc-300 truncate drop-shadow-sm mt-0.5 font-medium">
                    {toast.marker.comment}
                  </div>
                )}

                <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-semibold">
                  <span>Marked by:</span>
                  <span className="text-white font-bold">{toast.marker.memberName}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Left: Squad Status Widget */}
      <div className="fixed bottom-6 left-6 pointer-events-none z-40">
        <div className="rounded-xl border border-white/10 bg-zinc-950/80 p-3 backdrop-blur-md shadow-2xl min-w-[260px]">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-indigo-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">StreamCollab Squad</span>
            </div>
            {activeSession && (
              <span className="text-[10px] font-mono text-emerald-400 font-semibold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/30">
                ACTIVE
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {members.length === 0 ? (
              <div className="text-[11px] text-zinc-400 italic">No members connected</div>
            ) : (
              members.map((m) => {
                const isRec = m.obsStatus === 'recording';
                const isPaused = m.obsStatus === 'paused';

                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-2 py-1.5 border border-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-200 uppercase border border-zinc-700">
                          {m.name.slice(0, 2)}
                        </div>
                        {isRec ? (
                          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                          </span>
                        ) : isPaused ? (
                          <span className="absolute -top-0.5 -right-0.5 inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
                        ) : (
                          <span className="absolute -top-0.5 -right-0.5 inline-flex rounded-full h-2.5 w-2.5 bg-zinc-600" />
                        )}
                      </div>

                      <span className="text-xs font-semibold text-zinc-200">{m.name}</span>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      {isRec ? (
                        <span className="text-red-400 font-bold">REC</span>
                      ) : isPaused ? (
                        <span className="text-amber-400 font-bold">PAUSE</span>
                      ) : (
                        <span className="text-zinc-500 font-medium">IDLE</span>
                      )}
                      <span className="text-zinc-600">|</span>
                      <span className="text-zinc-400">{m.fps || 60}fps</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
