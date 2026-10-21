import React, { useState, useEffect, useMemo } from 'react';
import { SquadMember, Room, RecordingSession, SquadMarker, ClientKind } from '@streamcollab/shared';
import { ObsService } from './services/obs';
import { StreamCollabSocketClient } from './services/socket';
import { getLastRoom, saveLastRoom, saveHostToken } from './services/credentials';
import { DockView } from './views/DockView';
import { HudView } from './views/HudView';
import { DashboardView } from './views/DashboardView';
import { Monitor, Tv, LayoutDashboard } from 'lucide-react';

function newMemberId() {
  return 'mem_' + Math.random().toString(36).substring(2, 9);
}

export function App() {
  // Parse initial view from pathname, query parameters, or hash
  const initialView = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view')?.toLowerCase();
    if (viewParam && ['dock', 'hud', 'dashboard'].includes(viewParam)) {
      return viewParam;
    }
    const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    if (['dock', 'hud', 'dashboard'].includes(hash)) {
      return hash;
    }
    const path = window.location.pathname.replace(/^\//, '').toLowerCase();
    if (['dock', 'hud', 'dashboard'].includes(path)) {
      return path;
    }
    return 'dock';
  }, []);

  const initialRoom = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || getLastRoom() || '';
  }, []);

  const [currentView, setCurrentView] = useState<string>(initialView);
  const [roomId, setRoomId] = useState<string>(initialRoom);
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('streamcollab_username') || `Player_${Math.floor(100 + Math.random() * 900)}`;
  });

  // Draft values for the nav inputs; only committed (blur / Enter) values trigger a rejoin
  const [roomDraft, setRoomDraft] = useState<string>(initialRoom);
  const [nameDraft, setNameDraft] = useState<string>(userName);

  const commitRoom = () => {
    const next = roomDraft.trim();
    if (next && next !== roomId) {
      setRoomId(next);
    } else {
      setRoomDraft(roomId);
    }
  };

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== userName) {
      setUserName(next);
      localStorage.setItem('streamcollab_username', next);
    } else {
      setNameDraft(userName);
    }
  };

  // Only docks represent a squad member; HUD overlays and dashboards observe
  const clientKind: ClientKind = currentView === 'hud' ? 'hud' : currentView === 'dashboard' ? 'dashboard' : 'dock';

  const [memberId, setMemberId] = useState(() => {
    let id = localStorage.getItem('streamcollab_member_id');
    if (!id) {
      id = newMemberId();
      localStorage.setItem('streamcollab_member_id', id);
    }
    return id;
  });

  const member: SquadMember = useMemo(
    () => ({
      id: memberId,
      name: userName,
      role: 'player',
      obsStatus: 'disconnected',
      fps: 60,
      outputDurationMs: 0,
      clockOffsetMs: 0,
      rttMs: 0,
      lastHeartbeat: 0, // set by the server on join
    }),
    [memberId, userName]
  );

  // Services singletons
  const obsService = useMemo(() => new ObsService(), []);
  const socketClient = useMemo(() => new StreamCollabSocketClient(), []);

  // Shared state from server
  const [room, setRoom] = useState<Room | null>(null);
  const [activeSession, setActiveSession] = useState<RecordingSession | null>(null);
  const [lastSession, setLastSession] = useState<RecordingSession | null>(null);
  const [markers, setMarkers] = useState<SquadMarker[]>([]);
  // Join outcome for one (room, view, member) combination; anything else reads as "not joined yet",
  // so switching rooms needs no reset
  const joinKey = `${roomId}|${clientKind}|${member.id}`;
  const [joinState, setJoinState] = useState<{ key: string; isHost: boolean; error: string | null }>({
    key: '',
    isHost: false,
    error: null,
  });
  const isHost = joinState.key === joinKey && joinState.isHost;
  const joinError = joinState.key === joinKey ? joinState.error : null;
  const dismissJoinError = () => setJoinState((state) => ({ ...state, error: null }));

  const switchRoom = (newRoom: string) => {
    setRoomId(newRoom);
    setRoomDraft(newRoom);
  };

  // Initialize socket and listeners
  useEffect(() => {
    const subscriptions: Array<() => void> = [];
    const setJoinError = (error: string | null) =>
      setJoinState((state) => ({ key: joinKey, isHost: state.key === joinKey && state.isHost, error }));
    subscriptions.push(
      socketClient.on('onRoomState', (state) => {
        setRoom(state.room);
        setActiveSession(state.activeSession);
        if (state.activeSession) {
          setLastSession(state.activeSession);
        }
        setMarkers(state.markers);
      })
    );

    subscriptions.push(
      socketClient.on('onMemberJoined', (newMember) => {
        setRoom((prev) => {
          if (!prev) return null;
          const exists = prev.members.some((m) => m.id === newMember.id);
          const members = exists
            ? prev.members.map((m) => (m.id === newMember.id ? newMember : m))
            : [...prev.members, newMember];
          return { ...prev, members };
        });
      })
    );

    subscriptions.push(
      socketClient.on('onMemberLeft', (leftMemberId) => {
        setRoom((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            members: prev.members.map((m) => (m.id === leftMemberId ? { ...m, obsStatus: 'disconnected' } : m)),
          };
        });
      })
    );

    subscriptions.push(
      socketClient.on('onMemberUpdated', (updatedMember) => {
        setRoom((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            members: prev.members.map((m) => (m.id === updatedMember.id ? updatedMember : m)),
          };
        });
      })
    );

    subscriptions.push(
      socketClient.on('onMarkerAdded', (marker) => {
        setMarkers((prev) => {
          if (prev.some((m) => m.id === marker.id)) return prev;
          return [...prev, marker];
        });
      })
    );

    subscriptions.push(
      socketClient.on('onSessionStarted', (session) => {
        setActiveSession(session);
        setLastSession(session);
        setMarkers([]);
      })
    );

    subscriptions.push(
      socketClient.on('onSessionStopped', (session) => {
        setActiveSession(null);
        setLastSession(session);
      })
    );

    subscriptions.push(
      socketClient.on('onJoined', (info) => {
        setJoinState({ key: joinKey, isHost: info.isHost, error: null });
      })
    );

    subscriptions.push(
      socketClient.on('onError', (error) => {
        if (error.code === 'MEMBER_TOKEN_INVALID') {
          // This browser lost the token for its member id (cleared storage, closed before it arrived...).
          // The old id stays locked to protect it, so continue under a fresh identity.
          const freshId = newMemberId();
          localStorage.setItem('streamcollab_member_id', freshId);
          setMemberId(freshId);
          return;
        }
        setJoinError(error.message);
        if (error.code === 'HOST_TOKEN_INVALID' && roomId) {
          // Forget the bad token and join again as a viewer
          saveHostToken(roomId, null);
          socketClient.rejoin();
        }
        if (error.code === 'ROOM_NOT_FOUND') {
          setRoom(null);
          setActiveSession(null);
          setLastSession(null);
          setMarkers([]);
        }
      })
    );

    socketClient.connect();
    if (roomId) {
      saveLastRoom(roomId);
      socketClient.joinRoom(roomId, clientKind, member);
    }

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      socketClient.disconnect();
    };
  }, [socketClient, roomId, member, clientKind, joinKey]);

  // Handle URL hash changes
  useEffect(() => {
    const handleHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '').toLowerCase();
      if (['dock', 'hud', 'dashboard'].includes(h)) {
        setCurrentView(h);
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // For HUD view in OBS Browser Source, render transparent without wrapper navigation
  if (currentView === 'hud') {
    return <HudView socketClient={socketClient} members={room?.members || []} activeSession={activeSession} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* View Switcher Bar (Hidden if loaded as an embedded dock or explicit view) */}
      <nav className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-4 py-2 text-xs">
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setCurrentView('dock');
              window.location.hash = '/dock';
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
              currentView === 'dock'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            OBS Dock
          </button>

          <button
            onClick={() => {
              setCurrentView('hud');
              window.location.hash = '/hud';
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
              currentView === 'hud'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Monitor className="h-3.5 w-3.5" />
            OBS Overlay HUD
          </button>

          <button
            onClick={() => {
              setCurrentView('dashboard');
              window.location.hash = '/dashboard';
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-semibold transition ${
              currentView === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Director Panel
          </button>
        </div>

        {/* Room & User Setting */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder="Your streamer name"
            className="w-28 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
            title="Streamer Display Name"
          />

          <input
            type="text"
            value={roomDraft}
            onChange={(e) => setRoomDraft(e.target.value)}
            onBlur={commitRoom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder="Room ID"
            className="w-24 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs font-mono text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
            title="Active Room Code"
          />
        </div>
      </nav>

      {(joinError || !roomId) && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <span>
            {joinError ||
              'No room selected. Enter the room code from your host, or create a room in the Director Panel.'}
          </span>
          {joinError && (
            <button onClick={dismissJoinError} className="text-amber-400 hover:text-amber-200" title="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}

      {/* Active View */}
      <main className="flex-1 flex flex-col">
        {currentView === 'dock' && (
          <DockView
            socketClient={socketClient}
            obsService={obsService}
            roomId={roomId}
            member={member}
            room={room}
            activeSession={activeSession}
            lastSession={lastSession}
            markers={markers}
          />
        )}

        {currentView === 'dashboard' && (
          <DashboardView
            socketClient={socketClient}
            roomId={roomId}
            room={room}
            activeSession={activeSession}
            lastSession={lastSession}
            markers={markers}
            isHost={isHost}
            onRoomChange={switchRoom}
          />
        )}
      </main>
    </div>
  );
}
export default App;
