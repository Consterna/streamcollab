import { SntpPingPayload, SntpPongPayload } from '@streamcollab/shared';

export interface SntpMeasurement {
  rtt: number;
  offset: number;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

export class SntpClockEngine {
  /**
   * Handle incoming SNTP Ping from client
   * Records T2 (receive) and generates T3 (transmit)
   */
  static handlePing(ping: SntpPingPayload): SntpPongPayload {
    const t2 = Date.now();
    const t3 = Date.now(); // or performance.now() epoch-aligned
    return {
      t1: ping.t1,
      t2,
      t3,
    };
  }

  /**
   * Calculate RTT and Clock Offset given the four timestamps
   * T1 = Client send
   * T2 = Server receive
   * T3 = Server reply send
   * T4 = Client receive
   */
  static calculateOffset(t1: number, t2: number, t3: number, t4: number): SntpMeasurement {
    const rtt = Math.max(0, (t4 - t1) - (t3 - t2));
    const offset = ((t2 - t1) + (t3 - t4)) / 2;
    return {
      rtt,
      offset,
      t1,
      t2,
      t3,
      t4,
    };
  }

  /**
   * Exponential moving average filter for clock offset calibration
   */
  static smoothOffset(currentOffset: number, newOffset: number, alpha: number = 0.3): number {
    return currentOffset * (1 - alpha) + newOffset * alpha;
  }
}
