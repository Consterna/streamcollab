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

export class ObsService {
  private obs: OBSWebSocket;
  private isConnected = false;
  private pollInterval: any = null;

  onStatusChange?: (connected: boolean) => void;
  onRecordChange?: (status: ObsRecordStatus) => void;

  constructor() {
    this.obs = new OBSWebSocket();
  }

  get connected(): boolean {
    return this.isConnected;
  }

  async connect(address = 'ws://127.0.0.1:4455', password?: string): Promise<boolean> {
    try {
      await this.obs.connect(address, password || undefined, {
        eventSubscriptions: 0x00000001 | 0x00000040, // General + Outputs
      });

      this.isConnected = true;
      this.onStatusChange?.(true);

      this.setupListeners();
      this.startPolling();

      return true;
    } catch (err) {
      console.warn('[ObsService] Failed to connect to OBS WebSocket:', err);
      this.isConnected = false;
      this.onStatusChange?.(false);
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
      this.onStatusChange?.(false);
    }
  }

  private setupListeners() {
    this.obs.on('RecordStateChanged', (data) => {
      this.queryRecordStatus();
    });

    this.obs.on('ConnectionClosed', () => {
      this.isConnected = false;
      this.stopPolling();
      this.onStatusChange?.(false);
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
      this.onRecordChange?.(status);
      return status;
    } catch (err) {
      return null;
    }
  }
}
