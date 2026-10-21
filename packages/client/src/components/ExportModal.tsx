import React, { useState, useEffect } from 'react';
import {
  RecordingSession,
  SquadMarker,
  SquadMember,
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
} from '@streamcollab/shared';
import { apiUrl } from '../services/serverUrl';
import { Download, Copy, Check, X, FileText, Film, Table, Youtube, Layers } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: RecordingSession | null;
  markers: SquadMarker[];
  members: SquadMember[];
  roomId: string;
}

type ExportType = 'edl' | 'xml' | 'csv' | 'youtube' | 'matrix';

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  session,
  markers,
  members,
  roomId,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportType>('edl');
  const [copied, setCopied] = useState(false);
  const [content, setContent] = useState('');

  // '' = master session timeline; otherwise a member id for that streamer's own recording file
  const [povMemberId, setPovMemberId] = useState('');

  useEffect(() => {
    if (!isOpen || !session) return;

    // Per-POV timelines and the sync matrix need the server's recording anchors
    if (povMemberId || selectedFormat === 'matrix') {
      const controller = new AbortController();
      const params = new URLSearchParams({ sessionId: session.id });
      if (povMemberId) params.set('memberId', povMemberId);
      setContent('// Loading from server...');
      fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/export/${selectedFormat}?${params}`), { signal: controller.signal })
        .then(async (res) => {
          const text = await res.text();
          if (!res.ok) {
            let message = text;
            try {
              message = JSON.parse(text).error || text;
            } catch {
              // plain-text error body
            }
            setContent(`// ${message}`);
            return;
          }
          setContent(selectedFormat === 'matrix' ? JSON.stringify(JSON.parse(text), null, 2) : text);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setContent(`// Export failed: ${err.message}`);
        });
      return () => controller.abort();
    }

    let text = '';
    switch (selectedFormat) {
      case 'edl':
        text = exportToEdl(session, markers, { title: session.name });
        break;
      case 'xml':
        text = exportToFcpXml(session, markers, { sequenceName: session.name });
        break;
      case 'csv':
        text = exportToCsv(session, markers);
        break;
      case 'youtube':
        text = exportToYouTubeChapters(session, markers);
        break;
    }
    setContent(text);
  }, [isOpen, selectedFormat, session, markers, members, roomId, povMemberId]);

  if (!isOpen || !session) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const extensions: Record<ExportType, string> = {
      edl: 'edl',
      xml: 'xml',
      csv: 'csv',
      youtube: 'txt',
      matrix: 'json',
    };
    const mimeTypes: Record<ExportType, string> = {
      edl: 'text/plain',
      xml: 'application/xml',
      csv: 'text/csv',
      youtube: 'text/plain',
      matrix: 'application/json',
    };

    const ext = extensions[selectedFormat];
    const mime = mimeTypes[selectedFormat];
    const povName = members.find((m) => m.id === povMemberId)?.name;
    const baseName = povName ? `${session.name}_${povName}` : session.name;
    const filename = `${baseName.replace(/\s+/g, '_')}_markers.${ext}`;

    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formats: { id: ExportType; label: string; desc: string; icon: any }[] = [
    { id: 'edl', label: 'DaVinci Resolve', desc: 'CMX 3600 EDL (Color markers)', icon: Film },
    { id: 'xml', label: 'Premiere Pro', desc: 'Final Cut Pro 7 XML (xmeml v4)', icon: FileText },
    { id: 'csv', label: 'Universal CSV', desc: 'Excel, Sheets & Markerbox', icon: Table },
    { id: 'youtube', label: 'YouTube Chapters', desc: 'Video description timestamp format', icon: Youtube },
    { id: 'matrix', label: 'Multicam Matrix', desc: 'Multi-POV sync matrix JSON', icon: Layers },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-3xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Film className="h-5 w-5 text-indigo-400" />
              Export NLE Timeline & Markers
            </h2>
            <p className="text-xs text-zinc-400">
              Session: <span className="font-semibold text-zinc-200">{session.name}</span> ({markers.length} markers)
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Format Selector Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-b border-zinc-800 p-4 bg-zinc-950/50">
          {formats.map((f) => {
            const Icon = f.icon;
            const isSelected = selectedFormat === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setSelectedFormat(f.id)}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-sm'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <Icon className={`h-5 w-5 mb-1 ${isSelected ? 'text-indigo-400' : 'text-zinc-400'}`} />
                <span className="text-xs font-semibold">{f.label}</span>
                <span className="text-[10px] text-zinc-500 hidden sm:block truncate max-w-full">{f.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Timeline selector: master session or one streamer's own recording file */}
        {members.length > 0 && (
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2 text-xs bg-zinc-950/50">
            <span className="text-zinc-400 font-medium">Timeline:</span>
            <select
              value={povMemberId}
              onChange={(e) => setPovMemberId(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
            >
              <option value="">Master session</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}'s recording (POV)
                </option>
              ))}
            </select>
            {povMemberId && (
              <span className="text-zinc-500">Markers re-timed to the start of this streamer's OBS file</span>
            )}
          </div>
        )}

        {/* Preview Code View */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-300 bg-zinc-950">
          <pre className="whitespace-pre overflow-x-auto selection:bg-indigo-600 selection:text-white">
            {content || '// No markers in this session yet.'}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4 bg-zinc-900">
          <div className="text-xs text-zinc-400">
            Framerate: <span className="text-zinc-200">{session.framerateNumerator}/{session.framerateDenominator} fps</span>
            {session.dropFrame && ' (Drop Frame)'} | Base TC: <span className="text-zinc-200">{session.baseTimecode}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 transition"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition"
            >
              <Download className="h-4 w-4" />
              Download File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
