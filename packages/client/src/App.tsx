import { useState, useEffect, useMemo, useCallback } from 'react';
import { SquadMember, Room, RecordingSession, SquadMarker, ClientKind, LIMITS } from '@streamcollab/shared';
import { ObsService } from './services/obs';
import { StreamCollabSocketClient } from './services/socket';
import {
  getLastRoom,
  saveLastRoom,
  saveHostToken,
  getStoredMemberId,
  saveMemberId,
  getStoredUserName,
  saveUserName,
  serverAwaitingTrust,
  trustCurrentServer,
  distrustCurrentServer,
} from './services/credentials';
import { DockView } from './views/DockView';
import { HudView } from './views/HudView';
import { DashboardView } from './views/DashboardView';
import { HudPreviewBar } from './components/HudPreviewBar';
import { LOCALES, Locale, MessageKey, useT } from './i18n';
import { viewUrl } from './services/serverUrl';
import { Monitor, Tv, LayoutDashboard } from 'lucide-react';

/** Generated room codes (e.g. KQ7P-M3XD) are shown in capitals; accept them typed in any case */
export function normalizeRoomCode(input: string): string {
  const code = input.trim();
  return /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(code) ? code.toUpperCase() : code;
}

/** Banner error: translated by its code when known, otherwise the server's message */
interface JoinError {
  code?: string;
  message: string;
  room?: string;
}

// Errors after which this client is no longer in the room
const LEAVES_ROOM = new Set(['ROOM_NOT_FOUND', 'ROOM_DELETED', 'HOST_TOKEN_INVALID', 'MEMBER_TOKEN_INVALID']);

const TRANSLATED_ERRORS: Record<string, MessageKey> = {
  ROOM_DELETED: 'error.ROOM_DELETED',
  ROOM_NOT_FOUND: 'error.ROOM_NOT_FOUND',
  RATE_LIMITED: 'error.RATE_LIMITED',
  HOST_TOKEN_INVALID: 'error.HOST_TOKEN_INVALID',
  FORBIDDEN: 'error.FORBIDDEN',
  NOT_FOUND: 'error.NOT_FOUND',
  INVALID_MESSAGE: 'error.INVALID_MESSAGE',
};

function newMemberId() {
  return 'mem_' + Math.random().toString(36).substring(2, 9);
}

type View = 'dock' | 'hud' | 'dashboard';
const VIEWS: View[] = ['dock', 'hud', 'dashboard'];

function asView(value: string | null | undefined): View | null {
  const v = value?.toLowerCase();
  return VIEWS.includes(v as View) ? (v as View) : null;
}

/**
 * Keep the URL in sync with the view (`?view=`), so reloading stays on the same screen.
 * `preview=1` marks a HUD opened from the app itself, which shows a way back; the HUD link
 * used in OBS never carries it, so the real overlay stays clean.
 */
function writeViewToUrl(view: View, preview: boolean) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', view);
  if (preview) {
    url.searchParams.set('preview', '1');
  } else {
    url.searchParams.delete('preview');
  }
  url.hash = '';
  window.history.replaceState(null, '', url);
}

/** Keep `?room=` on the room in use, so a reload doesn't go back to the room of the invite link */
function writeRoomToUrl(roomId: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('room') === (roomId || null)) return;
  if (roomId) {
    url.searchParams.set('room', roomId);
  } else {
    url.searchParams.delete('room');
  }
  window.history.replaceState(null, '', url);
}

export function App() {
  const { t, locale, setLocale } = useT();
  // Parse initial view from query parameters, hash (legacy links) or pathname
  const initialView = useMemo<View>(() => {
    const params = new URLSearchParams(window.location.search);
    return (
      asView(params.get('view')) ??
      asView(window.location.hash.replace(/^#\/?/, '')) ??
      asView(window.location.pathname.replace(/^\//, '')) ??
      'dock'
    );
  }, []);
  const initialHudPreview = useMemo(
    () => initialView === 'hud' && new URLSearchParams(window.location.search).get('preview') === '1',
    [initialView]
  );

  const initialRoom = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return normalizeRoomCode(params.get('room') || getLastRoom() || '');
  }, []);

  const [currentView, setCurrentView] = useState<View>(initialView);
  const [hudPreview, setHudPreview] = useState(initialHudPreview);
  // Where "Back" returns from the HUD preview
  const [returnView, setReturnView] = useState<View>('dock');

  const navigateTo = useCallback(
    (view: View) => {
      const preview = view === 'hud';
      if (preview && currentView !== 'hud') setReturnView(currentView);
      writeViewToUrl(view, preview);
      setCurrentView(view);
      setHudPreview(preview);
    },
    [currentView]
  );

  const exitHudPreview = useCallback(() => navigateTo(returnView), [navigateTo, returnView]);
  const [roomId, setRoomId] = useState<string>(initialRoom);
  // Bumped to join the same room code again after the server refused it
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [userName, setUserName] = useState<string>(() => {
    // Names longer than the server accepts (possible before v1.6.2) would keep the dock out of every room
    const saved = getStoredUserName()?.trim().slice(0, LIMITS.memberName);
    if (saved) return saved;
    // Keep the generated name, otherwise the same streamer shows up under a new name on every load
    const generated = `Player_${Math.floor(100 + Math.random() * 900)}`;
    saveUserName(generated);
    return generated;
  });

  // Draft values for the nav inputs; only committed (blur / Enter) values trigger a rejoin
  const [roomDraft, setRoomDraft] = useState<string>(initialRoom);
  const [nameDraft, setNameDraft] = useState<string>(userName);

  const commitRoom = () => {
    const next = normalizeRoomCode(roomDraft);
    setRoomDraft(next);
    if (next && next !== roomId) {
      setRoomId(next);
    } else {
      setRoomDraft(roomId);
      // The same code while not in that room (refused, or the room was deleted): ask the server once
      // more, it may exist now. A dock that is in the room keeps its connection.
      if (next && !inRoom) setJoinAttempt((n) => n + 1);
    }
  };

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== userName) {
      setUserName(next);
      saveUserName(next);
    } else {
      setNameDraft(userName);
    }
  };

  // Only docks represent a squad member; HUD overlays and dashboards observe
  const clientKind: ClientKind = currentView === 'hud' ? 'hud' : currentView === 'dashboard' ? 'dashboard' : 'dock';

  // `?server=` names a server this device has credentials for from before v1.6.2: nothing is sent to
  // it (not even a join) until the user decides whether to trust it with them
  // (an OBS HUD source has no way to answer and only observes, so it just goes without them)
  const [serverToTrust, setServerToTrust] = useState<string | null>(() =>
    initialView === 'hud' ? null : serverAwaitingTrust()
  );

  const [memberId, setMemberId] = useState(() => {
    let id = getStoredMemberId();
    if (!id) {
      id = newMemberId();
      // Saved once the trust question is answered (accepting may bring back the old id)
      if (!serverAwaitingTrust()) saveMemberId(id);
    }
    return id;
  });

  const answerServerTrust = (trust: boolean) => {
    if (trust) {
      trustCurrentServer();
    } else {
      distrustCurrentServer();
    }
    let id = getStoredMemberId();
    if (!id) {
      id = memberId;
      saveMemberId(id);
    }
    setMemberId(id);
    setServerToTrust(null);
  };

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
  const [joinState, setJoinState] = useState<{
    key: string;
    isHost: boolean;
    error: JoinError | null;
    // The server accepted this client into the room (JOINED) and hasn't refused or deleted it since
    joined: boolean;
  }>({
    key: '',
    isHost: false,
    error: null,
    joined: false,
  });
  const isHost = joinState.key === joinKey && joinState.isHost;
  const inRoom = joinState.key === joinKey && joinState.joined;
  const joinError = joinState.key === joinKey ? joinState.error : null;
  const dismissJoinError = () => setJoinState((state) => ({ ...state, error: null }));

  const switchRoom = (newRoom: string) => {
    setRoomId(newRoom);
    setRoomDraft(newRoom);
  };

  useEffect(() => writeRoomToUrl(roomId), [roomId]);

  // Initialize socket and listeners
  useEffect(() => {
    // The HUD only observes, so it doesn't wait for the answer; until the server is trusted it only
    // gets that server's own credentials, never the older shared ones
    if (serverToTrust && clientKind !== 'hud') return;
    const subscriptions: Array<() => void> = [];
    const setJoinError = (error: JoinError | null) =>
      setJoinState((state) => ({
        key: joinKey,
        isHost: state.key === joinKey && state.isHost,
        error,
        // Refusals and deletion take this client out of the room; other errors (a forbidden edit,
        // a rate limit) don't
        joined: state.key === joinKey && state.joined && !LEAVES_ROOM.has(error?.code ?? ''),
      }));
    subscriptions.push(
      socketClient.on('onRoomState', (state) => {
        setRoom(state.room);
        setActiveSession(state.activeSession);
        // The markers belong to this session (servers before v1.6.1 don't send latestSession)
        setLastSession(state.activeSession ?? state.latestSession ?? null);
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
            members: prev.members.map((m) =>
              m.id === leftMemberId ? { ...m, obsStatus: 'disconnected', online: false, lastHeartbeat: Date.now() } : m
            ),
          };
        });
      })
    );

    subscriptions.push(
      socketClient.on('onMemberRemoved', (removedMemberId) => {
        setRoom((prev) => (prev ? { ...prev, members: prev.members.filter((m) => m.id !== removedMemberId) } : prev));
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
      socketClient.on('onMarkerUpdated', (marker) => {
        setMarkers((prev) => prev.map((m) => (m.id === marker.id ? marker : m)));
      })
    );

    subscriptions.push(
      socketClient.on('onMarkerDeleted', ({ markerId }) => {
        setMarkers((prev) => prev.filter((m) => m.id !== markerId));
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
      socketClient.on('onSessionDeleted', (sessionId) => {
        setLastSession((prev) => (prev?.id === sessionId ? null : prev));
        setMarkers((prev) => prev.filter((m) => m.sessionId !== sessionId));
      })
    );

    subscriptions.push(
      socketClient.on('onRoomDeleted', (deletedRoomId) => {
        saveHostToken(deletedRoomId, null);
        setRoom(null);
        setActiveSession(null);
        setLastSession(null);
        setMarkers([]);
        setJoinError({
          code: 'ROOM_DELETED',
          message: `Room ${deletedRoomId} was deleted by its host.`,
          room: deletedRoomId,
        });
      })
    );

    subscriptions.push(
      socketClient.on('onJoined', (info) => {
        setJoinState({ key: joinKey, isHost: info.isHost, error: null, joined: true });
      })
    );

    subscriptions.push(
      socketClient.on('onError', (error) => {
        if (error.code === 'MEMBER_TOKEN_INVALID') {
          // This browser lost the token for its member id (cleared storage, closed before it arrived...).
          // The old id stays locked to protect it, so continue under a fresh identity.
          const freshId = newMemberId();
          saveMemberId(freshId);
          setMemberId(freshId);
          return;
        }
        // Messages sent before the join completed; the dock stops sending them, and they'd hide the real error.
        // TIMEOUT only means this socket sat in no room (no code yet, or an unknown one): the banner
        // already says why, and the client reconnects by itself.
        if (error.code === 'NOT_JOINED' || error.code === 'TIMEOUT') return;
        setJoinError({ code: error.code, message: error.message, room: roomId });
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
  }, [socketClient, roomId, member, clientKind, joinKey, serverToTrust, joinAttempt]);

  // Legacy #/dock, #/hud, #/dashboard links typed into the address bar
  useEffect(() => {
    const handleHash = () => {
      const view = asView(window.location.hash.replace(/^#\/?/, ''));
      if (view) {
        writeViewToUrl(view, false);
        setCurrentView(view);
        setHudPreview(false);
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // For HUD view in OBS Browser Source, render transparent without wrapper navigation
  if (currentView === 'hud') {
    return (
      <>
        <HudView socketClient={socketClient} members={room?.members || []} activeSession={activeSession} />
        {hudPreview && <HudPreviewBar hudUrl={viewUrl('hud', roomId)} onExit={exitHudPreview} />}
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* View Switcher Bar (Hidden if loaded as an embedded dock or explicit view) */}
      {/* Wraps onto two rows in narrow OBS docks instead of pushing controls off-screen */}
      <nav className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/90 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => navigateTo('dock')}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 font-semibold transition ${
              currentView === 'dock'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            {t('nav.dock')}
          </button>

          <button
            onClick={() => navigateTo('hud')}
            title={t('nav.hudTitle')}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 font-semibold transition text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <Monitor className="h-3.5 w-3.5" />
            {t('nav.hud')}
          </button>

          <button
            onClick={() => navigateTo('dashboard')}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 font-semibold transition ${
              currentView === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            {t('nav.dashboard')}
          </button>
        </div>

        {/* Room & User Setting */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder={t('nav.namePlaceholder')}
            maxLength={LIMITS.memberName}
            aria-label={t('nav.nameTitle')}
            className="w-28 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
            title={t('nav.nameTitle')}
          />

          <input
            type="text"
            value={roomDraft}
            onChange={(e) => setRoomDraft(e.target.value)}
            onBlur={commitRoom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder={t('nav.roomPlaceholder')}
            maxLength={LIMITS.roomId}
            aria-label={t('nav.roomTitle')}
            className="w-24 rounded-sm border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs font-mono text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
            title={t('nav.roomTitle')}
          />

          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            aria-label={t('nav.language')}
            title={t('nav.language')}
            className="rounded-sm border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-hidden"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </nav>

      {serverToTrust && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-200"
        >
          <span>{t('app.trustServer', { server: serverToTrust })}</span>
          <span className="flex gap-2">
            <button
              onClick={() => answerServerTrust(true)}
              className="rounded-sm bg-sky-700 px-2 py-1 font-semibold text-white hover:bg-sky-600"
            >
              {t('app.trustServerYes')}
            </button>
            <button
              onClick={() => answerServerTrust(false)}
              className="rounded-sm border border-sky-500/40 px-2 py-1 text-sky-200 hover:bg-sky-500/20"
            >
              {t('app.trustServerNo')}
            </button>
          </span>
        </div>
      )}

      {(joinError || !roomId) && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <span>
            {joinError
              ? TRANSLATED_ERRORS[joinError.code ?? '']
                ? t(TRANSLATED_ERRORS[joinError.code ?? ''], {
                    room: joinError.room ?? roomId,
                    detail: joinError.message,
                  })
                : joinError.message
              : t('app.noRoom')}
          </span>
          {joinError && (
            <button
              onClick={dismissJoinError}
              className="text-amber-400 hover:text-amber-200"
              title={t('app.dismiss')}
              aria-label={t('app.dismiss')}
            >
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
