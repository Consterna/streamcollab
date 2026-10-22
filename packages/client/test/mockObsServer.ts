import { WebSocketServer, WebSocket } from 'ws';

export interface MockObsState {
  obsVersion: string;
  outputActive: boolean;
  outputPaused: boolean;
  outputTimecode: string;
  outputDuration: number;
  outputBytes: number;
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fpsNumerator: number;
  fpsDenominator: number;
  availableRequests: string[];
  rejectChapters?: boolean;
}

export class MockObsServer {
  private wss: WebSocketServer | null = null;
  private clientSocket: WebSocket | null = null;
  public state: MockObsState;

  constructor(initialState?: Partial<MockObsState>) {
    this.state = {
      obsVersion: '31.1.0',
      outputActive: false,
      outputPaused: false,
      outputTimecode: '00:00:00.000',
      outputDuration: 0,
      outputBytes: 0,
      baseWidth: 1920,
      baseHeight: 1080,
      outputWidth: 1920,
      outputHeight: 1080,
      fpsNumerator: 60,
      fpsDenominator: 1,
      availableRequests: [
        'GetVersion',
        'GetVideoSettings',
        'GetRecordStatus',
        'StartRecord',
        'StopRecord',
        'PauseRecord',
        'ResumeRecord',
        'CreateRecordChapter',
      ],
      ...initialState,
    };
  }

  start(port = 0): Promise<string> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer(
        {
          port,
          handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false),
        },
        () => {
          const addr = this.wss!.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : port;
          const url = `ws://127.0.0.1:${actualPort}`;

          this.wss!.on('connection', (socket) => {
            this.clientSocket = socket;

            // 1. Send OpCode 0 (Hello)
            socket.send(
              JSON.stringify({
                op: 0,
                d: {
                  obsWebSocketVersion: '5.5.0',
                  rpcVersion: 1,
                },
              })
            );

            socket.on('message', (raw) => {
              try {
                const msg = JSON.parse(raw.toString());
                this.handleMessage(socket, msg);
              } catch (e) {
                console.error('Mock OBS parse error', e);
              }
            });
          });

          resolve(url);
        }
      );
    });
  }

  private handleMessage(socket: WebSocket, msg: { op: number; d: any }) {
    if (msg.op === 1) {
      // OpCode 1: Identify -> respond with OpCode 2: Identified
      socket.send(
        JSON.stringify({
          op: 2,
          d: {
            negotiatedRpcVersion: 1,
          },
        })
      );
      return;
    }

    if (msg.op === 6) {
      // OpCode 6: Request
      const { requestType, requestId, requestData } = msg.d;
      const response = this.handleRequest(requestType, requestData);

      socket.send(
        JSON.stringify({
          op: 7,
          d: {
            requestType,
            requestId,
            requestStatus: response.status,
            responseData: response.data,
          },
        })
      );
    }
  }

  private handleRequest(
    requestType: string,
    _data?: any
  ): { status: { result: boolean; code: number; comment?: string }; data?: any } {
    switch (requestType) {
      case 'GetVersion':
        return {
          status: { result: true, code: 100 },
          data: {
            obsVersion: this.state.obsVersion,
            obsWebSocketVersion: '5.5.0',
            rpcVersion: 1,
            availableRequests: this.state.availableRequests,
          },
        };

      case 'GetVideoSettings':
        return {
          status: { result: true, code: 100 },
          data: {
            baseWidth: this.state.baseWidth,
            baseHeight: this.state.baseHeight,
            outputWidth: this.state.outputWidth,
            outputHeight: this.state.outputHeight,
            fpsNumerator: this.state.fpsNumerator,
            fpsDenominator: this.state.fpsDenominator,
          },
        };

      case 'GetRecordStatus':
        return {
          status: { result: true, code: 100 },
          data: {
            outputActive: this.state.outputActive,
            outputPaused: this.state.outputPaused,
            outputTimecode: this.state.outputTimecode,
            outputDuration: this.state.outputDuration,
            outputBytes: this.state.outputBytes,
          },
        };

      case 'CreateRecordChapter':
        if (this.state.rejectChapters) {
          return {
            status: { result: false, code: 600, comment: 'The current recording format does not support chapters' },
          };
        }
        return {
          status: { result: true, code: 100 },
          data: {},
        };

      default:
        return {
          status: { result: true, code: 100 },
          data: {},
        };
    }
  }

  /** Emit an OBS WebSocket v5 event (OpCode 5) */
  emitEvent(eventType: string, eventIntent: number, eventData: any) {
    if (this.clientSocket && this.clientSocket.readyState === WebSocket.OPEN) {
      this.clientSocket.send(
        JSON.stringify({
          op: 5,
          d: {
            eventType,
            eventIntent,
            eventData,
          },
        })
      );
    }
  }

  /** Simulate OBS recording state changes */
  setRecordingState(active: boolean, paused: boolean, durationMs = 0) {
    this.state.outputActive = active;
    this.state.outputPaused = paused;
    this.state.outputDuration = durationMs;
    this.emitEvent('RecordStateChanged', 64, {
      outputActive: active,
      outputState: active
        ? paused
          ? 'OBS_WEBSOCKET_OUTPUT_PAUSED'
          : 'OBS_WEBSOCKET_OUTPUT_STARTED'
        : 'OBS_WEBSOCKET_OUTPUT_STOPPED',
    });
  }

  /** Simulate Lua hotkey press via StreamCollab Signal input */
  triggerHotkeySignal(category: string, seq: number) {
    this.emitEvent('InputSettingsChanged', 8, {
      inputName: 'StreamCollab Signal',
      inputSettings: {
        sc_category: category,
        sc_seq: seq,
      },
    });
  }

  /** Simulate dynamic FPS change */
  setVideoSettings(fpsNumerator: number, fpsDenominator: number) {
    this.state.fpsNumerator = fpsNumerator;
    this.state.fpsDenominator = fpsDenominator;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.clientSocket) {
        this.clientSocket.terminate();
        this.clientSocket = null;
      }
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
