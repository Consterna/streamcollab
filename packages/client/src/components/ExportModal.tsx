import React, { useState, useEffect, useMemo } from 'react';
import {
  RecordingSession,
  SquadMarker,
  SquadMember,
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
  countYouTubeChapters,
  YOUTUBE_MIN_CHAPTERS,
} from '@streamcollab/shared';
import { apiUrl } from '../services/serverUrl';
import { useT } from '../i18n';
import type { LucideIcon } from 'lucide-react';
import { Download, Copy, Check, X, FileText, Film, Table, ListVideo, Layers } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: RecordingSession | null;
  markers: SquadMarker[];
  members: SquadMember[];
  roomId: string;
}

type ExportType = 'edl' | 'xml' | 'csv' | 'youtube' | 'matrix';

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, session, markers, members, roomId }) => {
  const { t } = useT();
  const [selectedFormat, setSelectedFormat] = useState<ExportType>('edl');
  const [copied, setCopied] = useState(false);

  // '' = master session timeline; otherwise a member id for that streamer's own recording file
  const [povMemberId, setPovMemberId] = useState('');

  // Per-POV timelines and the sync matrix need the server's recording anchors
  let remoteUrl: string | null = null;
  if (isOpen && session && (povMemberId || selectedFormat === 'matrix')) {
    const params = new URLSearchParams({ sessionId: session.id });
    if (povMemberId) params.set('memberId', povMemberId);
    remoteUrl = apiUrl(`/api/rooms/${encodeURIComponent(roomId)}/export/${selectedFormat}?${params}`);
  }
  // Include the marker count so new markers trigger a fresh export
  const remoteKey = remoteUrl ? `${remoteUrl}#${markers.length}` : null;
  const [remote, setRemote] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    if (!remoteUrl || !remoteKey) return;
    const controller = new AbortController();
    const done = (text: string) => setRemote({ key: remoteKey, text });
    fetch(remoteUrl, { signal: controller.signal })
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          let message = text;
          try {
            message = JSON.parse(text).error || text;
          } catch {
            // plain-text error body
          }
          done(`// ${message}`);
          return;
        }
        done(selectedFormat === 'matrix' ? JSON.stringify(JSON.parse(text), null, 2) : text);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') done(t('export.failed', { message: err.message }));
      });
    return () => controller.abort();
  }, [remoteUrl, remoteKey, selectedFormat, t]);

  // Master-timeline formats are generated locally from the live markers
  const localContent = useMemo(() => {
    if (!isOpen || !session || remoteUrl) return '';
    switch (selectedFormat) {
      case 'edl':
        return exportToEdl(session, markers, { title: session.name });
      case 'xml':
        return exportToFcpXml(session, markers, { sequenceName: session.name });
      case 'csv':
        return exportToCsv(session, markers);
      case 'youtube':
        return exportToYouTubeChapters(session, markers);
      default:
        return '';
    }
  }, [isOpen, session, markers, selectedFormat, remoteUrl]);

  const content = remoteUrl ? (remote?.key === remoteKey ? remote.text : t('export.loading')) : localContent;
  const loaded = !remoteUrl || remote?.key === remoteKey;
  const youtubeChapters = selectedFormat === 'youtube' && loaded ? countYouTubeChapters(content) : null;

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  const formats: { id: ExportType; label: string; desc: string; icon: LucideIcon }[] = [
    { id: 'edl', label: t('export.fmt.edl'), desc: t('export.fmt.edlDesc'), icon: Film },
    { id: 'xml', label: t('export.fmt.xml'), desc: t('export.fmt.xmlDesc'), icon: FileText },
    { id: 'csv', label: t('export.fmt.csv'), desc: t('export.fmt.csvDesc'), icon: Table },
    { id: 'youtube', label: t('export.fmt.youtube'), desc: t('export.fmt.youtubeDesc'), icon: ListVideo },
    { id: 'matrix', label: t('export.fmt.matrix'), desc: t('export.fmt.matrixDesc'), icon: Layers },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        className="relative w-full max-w-3xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 id="export-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
              <Film className="h-5 w-5 text-indigo-400" />
              {t('export.title')}
            </h2>
            <p className="text-xs text-zinc-400">
              {t('export.session')} <span className="font-semibold text-zinc-200">{session.name}</span>{' '}
              {t('export.markerCount', { count: markers.length })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                    ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-xs'
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
            <span className="text-zinc-400 font-medium">{t('export.timeline')}</span>
            <select
              value={povMemberId}
              onChange={(e) => setPovMemberId(e.target.value)}
              className="rounded-sm border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
            >
              <option value="">{t('export.master')}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {t('export.pov', { name: m.name })}
                </option>
              ))}
            </select>
            {povMemberId && <span className="text-zinc-500">{t('export.povHint')}</span>}
          </div>
        )}

        {youtubeChapters !== null && youtubeChapters < YOUTUBE_MIN_CHAPTERS && (
          <p role="status" className="border-b border-zinc-800 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            {t('export.youtubeTooFew', { min: YOUTUBE_MIN_CHAPTERS, count: youtubeChapters })}
          </p>
        )}

        {/* Preview Code View */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-300 bg-zinc-950">
          <pre className="whitespace-pre overflow-x-auto selection:bg-indigo-600 selection:text-white">
            {content || t('export.empty')}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4 bg-zinc-900">
          <div className="text-xs text-zinc-400">
            {t('export.framerate')}{' '}
            <span className="text-zinc-200">
              {session.framerateNumerator}/{session.framerateDenominator} fps
            </span>
            {session.dropFrame && t('export.dropFrame')} | {t('export.baseTc')}{' '}
            <span className="text-zinc-200">{session.baseTimecode}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 transition"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? t('export.copiedCode') : t('export.copyCode')}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20 transition"
            >
              <Download className="h-4 w-4" />
              {t('export.download')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
