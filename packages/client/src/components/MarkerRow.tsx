import React, { useState } from 'react';
import { MarkerCategory, MarkerChanges, SquadMarker } from '@streamcollab/shared';
import { Check, Pencil, Trash, X } from 'lucide-react';

interface MarkerRowProps {
  marker: SquadMarker;
  canEdit: boolean;
  onSave: (markerId: string, changes: MarkerChanges) => void;
  onDelete: (marker: SquadMarker) => void;
}

const CATEGORIES: MarkerCategory[] = ['kill', 'wipe', 'clutch', 'funny', 'note', 'custom'];

/** One timeline entry in the Director Panel, editable in place by the host */
export const MarkerRow: React.FC<MarkerRowProps> = ({ marker, canEdit, onSave, onDelete }) => {
  const [draft, setDraft] = useState<{ label: string; comment: string; category: MarkerCategory } | null>(null);

  const startEditing = () =>
    setDraft({ label: marker.label, comment: marker.comment ?? '', category: marker.category });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.label.trim()) return;
    const changes: MarkerChanges = {};
    if (draft.label.trim() !== marker.label) changes.label = draft.label.trim();
    if (draft.category !== marker.category) changes.category = draft.category;
    const comment = draft.comment.trim();
    if (comment !== (marker.comment ?? '')) changes.comment = comment || null;
    if (Object.keys(changes).length > 0) onSave(marker.id, changes);
    setDraft(null);
  };

  const inputClass =
    'rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden';

  return (
    <div className="group py-2.5 flex items-center justify-between gap-3 hover:bg-zinc-800/30 px-2 rounded-sm">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded-sm border border-indigo-800/40">
          {marker.timecode}
        </span>

        {draft ? (
          <form onSubmit={save} className="flex flex-1 flex-wrap items-center gap-2">
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as MarkerCategory })}
              className={inputClass}
              aria-label="Category"
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              maxLength={80}
              className={`${inputClass} w-36`}
              aria-label="Label"
              autoFocus
            />
            <input
              value={draft.comment}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
              maxLength={280}
              placeholder="Comment"
              className={`${inputClass} flex-1 min-w-24`}
              aria-label="Comment"
            />
            <button type="submit" className="rounded-sm p-1 text-emerald-400 hover:bg-zinc-800" title="Save">
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-sm p-1 text-zinc-400 hover:bg-zinc-800"
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm bg-zinc-800 text-zinc-300">
              {marker.category}
            </span>
            <div className="min-w-0">
              <span className="text-xs font-bold text-white">{marker.label}</span>
              {marker.comment && <p className="text-[11px] text-zinc-400 truncate">{marker.comment}</p>}
            </div>
          </>
        )}
      </div>

      {!draft && (
        <div className="flex items-center gap-3 shrink-0">
          {canEdit && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
              <button
                onClick={startEditing}
                className="rounded-sm p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                title="Edit marker"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDelete(marker)}
                className="rounded-sm p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                title="Delete marker"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="text-right">
            <span className="text-xs font-medium text-zinc-300">{marker.memberName}</span>
            <p className="text-[10px] font-mono text-zinc-500">{new Date(marker.timestamp).toLocaleTimeString()}</p>
          </div>
        </div>
      )}
    </div>
  );
};
