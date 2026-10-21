import React from 'react';
import { SessionSummary } from '@streamcollab/shared';
import { Clock3 } from 'lucide-react';

interface SessionHistoryProps {
  sessions: SessionSummary[];
  viewedSessionId: string | null;
  liveSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
}

function formatDuration(session: SessionSummary): string {
  if (!session.stoppedAt) return 'in progress';
  const seconds = Math.round((session.stoppedAt - session.startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Past and current sessions of the room; picking one shows and exports its markers */
export const SessionHistory: React.FC<SessionHistoryProps> = ({
  sessions,
  viewedSessionId,
  liveSessionId,
  onSelect,
}) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
    <h2 className="text-sm font-bold text-white flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
      <span className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-indigo-400" />
        Session History
      </span>
      {viewedSessionId && viewedSessionId !== liveSessionId && (
        <button
          onClick={() => onSelect(null)}
          className="rounded-sm bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-500 transition"
        >
          Back to current
        </button>
      )}
    </h2>

    {sessions.length === 0 ? (
      <p className="text-xs text-zinc-500">No sessions recorded in this room yet.</p>
    ) : (
      <ul className="space-y-1 max-h-64 overflow-y-auto">
        {sessions.map((session) => {
          const selected = (viewedSessionId ?? liveSessionId) === session.id;
          return (
            <li key={session.id}>
              <button
                onClick={() => onSelect(session.id === liveSessionId ? null : session.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  selected
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-white">{session.name}</span>
                  {!session.stoppedAt && (
                    <span className="rounded-sm bg-red-500/20 px-1.5 text-[10px] font-bold text-red-400">LIVE</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{new Date(session.startedAt).toLocaleString()}</span>
                  <span>
                    {session.markerCount} markers · {formatDuration(session)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
