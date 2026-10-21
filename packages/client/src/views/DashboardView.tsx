import React, { useState } from 'react';
import { Room, RecordingSession, SquadMarker } from '@streamcollab/shared';
import { StreamCollabSocketClient } from '../services/socket';
import { ExportModal } from '../components/ExportModal';
import { RoomSetupPanel } from '../components/RoomSetupPanel';
import { apiUrl } from '../services/serverUrl';
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
  const sessionForExport = activeSession || lastSession || null;
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Start session form state
  const [showStartModal, setShowStartModal] = useState(false);
  const [sessionName, setSessionName] = useState('Match 1 - Final Round');
  const [baseTimecode, setBaseTimecode] = useState('01:00:00:00');
  const [selectedFramerate, setSelectedFramerate] = useState('60');
  const [isDropFrame, setIsDropFrame] = useState(false);

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
      dropFrame: isDropFrame,
    });
    setShowStartModal(false);
  };

  const handleStopSession = () => {
    if (!activeSession) return;
    if (window.confirm(`Are you sure you want to stop recording session "${activeSession.name}"?`)) {
      socketClient.stopSession(roomId, activeSession.id);
    }
  };

  // Filter markers
  const filteredMarkers = markers.filter((m) => {
    const matchCat = filterCategory === 'all' || m.category === filterCategory;
    const matchSearch =
      searchQuery === '' ||
      m.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.comment && m.comment.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCat && matchSearch;
  });

  const members = room?.members || [];

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
              StreamCollab Director Panel
              <span className="rounded-sm bg-indigo-500/20 px-2 py-0.5 text-xs font-mono text-indigo-400 border border-indigo-500/30">
                Room: {room?.name || roomId}
              </span>
            </h1>
            <p className="text-xs text-zinc-400">Collaborative OBS Multicam & Live Squad Marker Command Center</p>
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
                title={isHost ? undefined : 'Only the room host can stop sessions'}
                className="disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-500 shadow-lg shadow-red-600/20 transition"
              >
                <Square className="h-4 w-4" />
                Stop Session
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowStartModal(true)}
              disabled={!isHost || !room}
              title={isHost ? undefined : 'Only the room host can start sessions'}
              className="disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 transition"
            >
              <Play className="h-4 w-4" />
              Start New Session
            </button>
          )}

          <button
            onClick={() => setIsExportOpen(true)}
            disabled={!sessionForExport}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-lg shadow-indigo-600/20"
          >
            <Download className="h-4 w-4" />
            Export Timeline
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
                <h2 className="text-sm font-bold text-white">Squad Sync & OBS Health Matrix</h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                  {members.length} Creators
                </span>
              </div>
            </div>

            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-zinc-500 text-xs">
                <Users className="h-8 w-8 text-zinc-700 mb-2" />
                <p>No squad members currently connected to this room.</p>
                <p className="text-[11px] text-zinc-600 mt-1">Open the OBS Dock in another tab or OBS to join.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] font-semibold text-zinc-400">
                      <th className="pb-2">CREATOR</th>
                      <th className="pb-2">ROLE</th>
                      <th className="pb-2">OBS STATUS</th>
                      <th className="pb-2">RECORD DURATION</th>
                      <th className="pb-2">FPS</th>
                      <th className="pb-2">CLOCK OFFSET (Δ)</th>
                      <th className="pb-2">RTT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {members.map((m) => {
                      const isRec = m.obsStatus === 'recording';
                      const isPaused = m.obsStatus === 'paused';

                      return (
                        <tr key={m.id} className="hover:bg-zinc-800/40 transition">
                          <td className="py-2.5 font-sans font-semibold text-white flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-950 text-indigo-300 text-[10px] font-bold border border-indigo-700/50">
                              {m.name.slice(0, 2).toUpperCase()}
                            </div>
                            {m.name}
                          </td>
                          <td className="py-2.5 font-sans capitalize text-zinc-400">{m.role}</td>
                          <td className="py-2.5 font-sans">
                            {isRec ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                                RECORDING
                              </span>
                            ) : isPaused ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/30">
                                PAUSED
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                                IDLE
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
                <h2 className="text-sm font-bold text-white">Live Event Timeline</h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                  {filteredMarkers.length} of {markers.length}
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
                    placeholder="Search markers..."
                    className="rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-hidden w-40 sm:w-48"
                  />
                </div>

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
                >
                  <option value="all">All Categories</option>
                  <option value="kill">Kills</option>
                  <option value="wipe">Squad Wipes</option>
                  <option value="clutch">Clutches</option>
                  <option value="funny">Funny</option>
                  <option value="note">Notes</option>
                </select>
              </div>
            </div>

            {filteredMarkers.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs">
                No markers found matching your current filter.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/80 max-h-96 overflow-y-auto">
                {filteredMarkers.map((m) => (
                  <div
                    key={m.id}
                    className="py-2.5 flex items-center justify-between hover:bg-zinc-800/30 px-2 rounded-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded-sm border border-indigo-800/40">
                        {m.timecode}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm bg-zinc-800 text-zinc-300">
                        {m.category}
                      </span>
                      <div>
                        <span className="text-xs font-bold text-white">{m.label}</span>
                        {m.comment && <p className="text-[11px] text-zinc-400">{m.comment}</p>}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-medium text-zinc-300">{m.memberName}</span>
                      <p className="text-[10px] font-mono text-zinc-500">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Session Information & Direct Export Suite */}
        <div className="space-y-6">
          {/* Session Overview Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-400" />
                <span>Recording Session Details</span>
              </div>
              {sessionForExport && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    activeSession
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
                      : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                  }`}
                >
                  {activeSession ? 'LIVE RECORDING' : 'COMPLETED'}
                </span>
              )}
            </h2>

            {sessionForExport ? (
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-zinc-500 block text-[11px]">Session Name:</span>
                  <span className="font-semibold text-white">{sessionForExport.name}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Framerate & Standard:</span>
                  <span className="font-mono text-zinc-200">
                    {sessionForExport.framerateNumerator}/{sessionForExport.framerateDenominator} fps
                    {sessionForExport.dropFrame ? ' (SMPTE Drop Frame)' : ' (Non-Drop Frame)'}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Base Timecode Offset:</span>
                  <span className="font-mono text-zinc-200">{sessionForExport.baseTimecode}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[11px]">Started At:</span>
                  <span className="text-zinc-300">{new Date(sessionForExport.startedAt).toLocaleString()}</span>
                </div>
                {sessionForExport.stoppedAt && (
                  <div>
                    <span className="text-zinc-500 block text-[11px]">Duration:</span>
                    <span className="text-zinc-300 font-mono">
                      {Math.floor((sessionForExport.stoppedAt - sessionForExport.startedAt) / 60000)}m{' '}
                      {Math.floor(((sessionForExport.stoppedAt - sessionForExport.startedAt) % 60000) / 1000)}s
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">
                No active session is currently running. Click "Start New Session" above to configure framerate and
                timeline.
              </div>
            )}
          </div>

          {/* Quick Exporters Box */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-xl">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 border-b border-zinc-800 pb-3 mb-3">
              <Download className="h-4 w-4 text-indigo-400" />
              Quick NLE Downloads
            </h2>
            <div className="space-y-2">
              <a
                href={
                  sessionForExport ? apiUrl(`/api/rooms/${roomId}/export/edl?sessionId=${sessionForExport.id}`) : '#'
                }
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !sessionForExport ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">DaVinci Resolve EDL</span>
                <span className="font-mono text-[10px] text-zinc-500">.edl</span>
              </a>

              <a
                href={
                  sessionForExport ? apiUrl(`/api/rooms/${roomId}/export/xml?sessionId=${sessionForExport.id}`) : '#'
                }
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !sessionForExport ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">Adobe Premiere Pro XML</span>
                <span className="font-mono text-[10px] text-zinc-500">.xml</span>
              </a>

              <a
                href={
                  sessionForExport ? apiUrl(`/api/rooms/${roomId}/export/csv?sessionId=${sessionForExport.id}`) : '#'
                }
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !sessionForExport ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">Universal CSV (Sheets/Excel)</span>
                <span className="font-mono text-[10px] text-zinc-500">.csv</span>
              </a>

              <a
                href={
                  sessionForExport
                    ? apiUrl(`/api/rooms/${roomId}/export/youtube?sessionId=${sessionForExport.id}`)
                    : '#'
                }
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !sessionForExport ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">YouTube Chapters</span>
                <span className="font-mono text-[10px] text-zinc-500">.txt</span>
              </a>

              <a
                href={
                  sessionForExport ? apiUrl(`/api/rooms/${roomId}/export/matrix?sessionId=${sessionForExport.id}`) : '#'
                }
                download
                className={`flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:border-indigo-500 hover:bg-indigo-500/10 text-xs transition ${
                  !sessionForExport ? 'pointer-events-none opacity-40' : ''
                }`}
              >
                <span className="font-medium text-zinc-200">Multicam Sync Matrix JSON</span>
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
              Configure Recording Session
            </h3>

            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1">Session Name</label>
              <input
                type="text"
                required
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="w-full rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1">Timeline Framerate</label>
              <select
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
                <option value="60">60 FPS (Gaming standard)</option>
                <option value="59.94">59.94 FPS (60000/1001 Broadcast)</option>
                <option value="50">50 FPS (PAL HD)</option>
                <option value="30">30 FPS</option>
                <option value="29.97">29.97 FPS (NTSC)</option>
                <option value="25">25 FPS</option>
                <option value="24">24 FPS (Cinematic)</option>
                <option value="23.976">23.976 FPS (24000/1001)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="dropFrame"
                checked={isDropFrame}
                onChange={(e) => setIsDropFrame(e.target.checked)}
                className="rounded-sm border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-0"
              />
              <label htmlFor="dropFrame" className="text-xs text-zinc-300">
                SMPTE Drop Frame (DF) mode
              </label>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-400 block mb-1">Base Starting Timecode</label>
              <input
                type="text"
                required
                value={baseTimecode}
                onChange={(e) => setBaseTimecode(e.target.value)}
                placeholder="01:00:00:00"
                className="w-full rounded-sm border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-white focus:border-indigo-500 focus:outline-hidden"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                Standard NLE broadcast starting timecode is usually 01:00:00:00.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowStartModal(false)}
                className="rounded-sm px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-sm bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
              >
                Start Recording
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        session={sessionForExport}
        markers={markers}
        members={members}
        roomId={roomId}
      />
    </div>
  );
};
