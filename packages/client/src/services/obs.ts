import OBSWebSocket from 'obs-websocket-js';

export interface ObsVideoSettings {
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fpsNumerator: number;
  fpsDenominator: number;
  fps: number;
}

export interface ObsRecordStatus {
  outputActive: boolean;
  outputPaused: boolean;
  outputTimecode: string;
  outputDuration: number; // in milliseconds
  outputBytes: number;
}

// Name of the input the StreamCollab OBS Lua script updates when a global hotkey is pressed
export const SIGNAL_INPUT_NAME = 'StreamCollab Signal';

export interface ObsHotkeySignal {
  category: string;
  seq: number;
}

/**
 * Native recording chapters (obs-websocket 5.5+ / OBS 30.2+, Hybrid MP4 only).
 * - unknown: not connected yet
 * - unsupported: this OBS has no CreateRecordChapter request
 * - available: supported; `lastError` is set if OBS rejected the last chapter (e.g. not Hybrid MP4)
 */
export interface ObsChapterSupport {
  state: 'unknown' | 'unsupported' | 'available';
  obsVersion?: string;
  lastError?: string;
}

export type ChapterResult = 'created' | 'not-recording' | 'unsupported' | 'failed';

export interface ObsServiceEvents {
  status: (connected: boolean) => void;
  record: (status: ObsRecordStatus) => void;
  hotkey: (signal: ObsHotkeySignal) => void;
  chapters: (support: ObsChapterSupport) => void;
}

// obs-websocket v5 event subscription bits
const EVENT_SUB_GENERAL = 1;
const EVENT_SUB_INPUTS = 8;
const EVENT_SUB_OUTPUTS = 64;

export class ObsService {
  private obs: OBSWebSocket;
  private isConnected = false;
  private pollInterval: any = null;

  // Last record status and when it was sampled, to extrapolate the in-file position at keypress time
  private lastRecordStatus: ObsRecordStatus | null = null;
  private lastRecordSampleAt = 0;
  private lastSignalSeq: number | null = null;
  private chapterSupport: ObsChapterSupport = { state: 'unknown' };

  private listeners: { [K in keyof ObsServiceEvents]: Set<ObsServiceEvents[K]> } = {
    status: new Set(),
    record: new Set(),
    hotkey: new Set(),
    chapters: new Set(),
  };

  /** Subscribe to OBS events; returns an unsubscribe function for effect cleanups */
  on<K extends keyof ObsServiceEvents>(event: K, handler: ObsServiceEvents[K]): () => void {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  private emit<K extends keyof ObsServiceEvents>(event: K, ...args: Parameters<ObsServiceEvents[K]>) {
    this.listeners[event].forEach((handler) => (handler as (...a: Parameters<ObsServiceEvents[K]>) => void)(...args));
  }

  constructor() {
    this.obs = new OBSWebSocket();
  }

  get connected(): boolean {
    return this.isConnected;
  }

  async connect(address = 'ws://127.0.0.1:4455', password?: string): Promise<boolean> {
    if (this.isConnected) {
      await this.disconnect();
    }
    try {
      await this.obs.connect(address, password || undefined, {
        eventSubscriptions: EVENT_SUB_GENERAL | EVENT_SUB_INPUTS | EVENT_SUB_OUTPUTS,
      });

      this.isConnected = true;
      this.emit('status', true);

      this.setupListeners();
      this.startPolling();
      void this.detectChapterSupport();

      return true;
    } catch (err) {
      console.warn('[ObsService] Failed to connect to OBS WebSocket:', err);
      this.isConnected = false;
      this.emit('status', false);
      return false;
    }
  }

  async disconnect() {
    this.stopPolling();
    if (this.isConnected) {
      try {
        await this.obs.disconnect();
      } catch (err) {
        // ignore
      }
      this.isConnected = false;
      this.emit('status', false);
    }
  }

  private setupListeners() {
    this.obs.removeAllListeners('RecordStateChanged');
    this.obs.removeAllListeners('InputSettingsChanged');
    this.obs.removeAllListeners('ConnectionClosed');

    this.obs.on('RecordStateChanged', () => {
      this.queryRecordStatus();
    });

    // Global hotkeys: the Lua script bumps `sc_seq` on the signal input; each new seq is one press
    this.obs.on('InputSettingsChanged', ({ inputName, inputSettings }) => {
      if (inputName !== SIGNAL_INPUT_NAME) return;
      const category = inputSettings?.sc_category;
      const seq = Number(inputSettings?.sc_seq);
      if (typeof category !== 'string' || !Number.isFinite(seq) || seq === this.lastSignalSeq) return;
      this.lastSignalSeq = seq;
      this.emit('hotkey', { category, seq });
    });

    this.obs.on('ConnectionClosed', () => {
      this.isConnected = false;
      this.stopPolling();
      this.emit('status', false);
    });
  }

  private startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      if (this.isConnected) {
        this.queryRecordStatus();
      }
    }, 1000);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Estimated position (ms) inside the current recording file right now, or null if not recording.
   * Extrapolates from the last GetRecordStatus sample so it is accurate between 1s polls.
   */
  getEstimatedRecordMs(): number | null {
    const status = this.lastRecordStatus;
    if (!this.isConnected || !status?.outputActive) return null;
    if (status.outputPaused) return status.outputDuration;
    return Math.round(status.outputDuration + (performance.now() - this.lastRecordSampleAt));
  }

  get chapters(): ObsChapterSupport {
    return this.chapterSupport;
  }

  private setChapterSupport(support: ObsChapterSupport) {
    this.chapterSupport = support;
    this.emit('chapters', support);
  }

  private async detectChapterSupport() {
    try {
      const version = await this.obs.call('GetVersion');
      const supported = version.availableRequests.includes('CreateRecordChapter');
      this.setChapterSupport({ state: supported ? 'available' : 'unsupported', obsVersion: version.obsVersion });
    } catch {
      this.setChapterSupport({ state: 'unknown' });
    }
  }

  /**
   * Drop a native chapter marker into the file OBS is recording right now, so editors see it
   * even without importing an EDL. Never throws: the squad marker matters more than the chapter.
   */
  async createChapter(name: string): Promise<ChapterResult> {
    if (!this.isConnected || !this.lastRecordStatus?.outputActive) return 'not-recording';
    if (this.chapterSupport.state !== 'available') return 'unsupported';
    try {
      await this.obs.call('CreateRecordChapter', { chapterName: name.slice(0, 120) });
      if (this.chapterSupport.lastError) {
        this.setChapterSupport({ ...this.chapterSupport, lastError: undefined });
      }
      return 'created';
    } catch (err) {
      // Typically the recording format is not Hybrid MP4
      const message = err instanceof Error && err.message ? err.message : 'OBS rejected the chapter';
      this.setChapterSupport({ ...this.chapterSupport, lastError: message });
      return 'failed';
    }
  }

  async getVideoSettings(): Promise<ObsVideoSettings | null> {
    if (!this.isConnected) return null;
    try {
      const res = await this.obs.call('GetVideoSettings');
      const fps = res.fpsDenominator ? res.fpsNumerator / res.fpsDenominator : 60;
      return {
        baseWidth: res.baseWidth,
        baseHeight: res.baseHeight,
        outputWidth: res.outputWidth,
        outputHeight: res.outputHeight,
        fpsNumerator: res.fpsNumerator,
        fpsDenominator: res.fpsDenominator,
        fps: Math.round(fps * 100) / 100,
      };
    } catch (err) {
      console.warn('[ObsService] GetVideoSettings error:', err);
      return null;
    }
  }

  async queryRecordStatus(): Promise<ObsRecordStatus | null> {
    if (!this.isConnected) return null;
    try {
      const res = await this.obs.call('GetRecordStatus');
      const status: ObsRecordStatus = {
        outputActive: res.outputActive,
        outputPaused: res.outputPaused,
        outputTimecode: res.outputTimecode,
        outputDuration: res.outputDuration,
        outputBytes: res.outputBytes,
      };
      this.lastRecordStatus = status;
      this.lastRecordSampleAt = performance.now();
      this.emit('record', status);
      return status;
    } catch (err) {
      return null;
    }
  }
}
