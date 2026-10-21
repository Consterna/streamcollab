import { describe, it, expect } from 'vitest';
import {
  SMPTETimecode,
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
  generateMulticamSyncMatrix,
  RecordingSession,
  SquadMarker,
} from '../src/index.js';

describe('Edge Cases and Robustness Verification', () => {
  const emptySession: RecordingSession = {
    id: 'empty-sess',
    roomId: 'room-edge',
    name: 'Empty <Test> & "Quotes"',
    startedAt: 1700000000000,
    stoppedAt: null,
    baseTimecode: '01:00:00:00',
    framerateNumerator: 60,
    framerateDenominator: 1,
    dropFrame: false,
  };

  describe('Zero Markers Handling', () => {
    it('EDL handles 0 markers without crashing', () => {
      const edl = exportToEdl(emptySession, []);
      expect(edl).toContain('TITLE: Empty Test  Quotes');
      expect(edl).toContain('FCM: NON-DROP FRAME');
      expect(edl.endsWith('\r\n')).toBe(true);
    });

    it('FCP XML handles 0 markers and escapes session name safely', () => {
      const xml = exportToFcpXml(emptySession, []);
      expect(xml).toContain('<name>Empty &lt;Test&gt; &amp; &quot;Quotes&quot;</name>');
      expect(xml).toContain('<track>');
      expect(xml).toContain('</track>');
    });

    it('CSV handles 0 markers and returns only valid header row', () => {
      const csv = exportToCsv(emptySession, []);
      expect(csv).toBe('Marker ID,Timestamp (UTC),Timecode,Frame,Relative Time (ms),Category,Creator,Label,Comment,Color,Session ID\r\n');
    });

    it('YouTube chapters handles 0 markers by generating 00:00 default chapter', () => {
      const yt = exportToYouTubeChapters(emptySession, []);
      expect(yt.trim()).toBe('00:00 Start of Stream');
    });

    it('Multicam matrix handles 0 markers and 0 members safely', () => {
      const matrix = generateMulticamSyncMatrix(emptySession, [], []);
      expect(matrix.members).toEqual([]);
      expect(matrix.markers).toEqual([]);
    });
  });

  describe('Sanitization and Escaping of Extreme Inputs', () => {
    const maliciousMarkers: SquadMarker[] = [
      {
        id: 'bad-1',
        roomId: 'room-edge',
        sessionId: 'empty-sess',
        memberId: 'mem-x',
        memberName: 'Hacker<script>alert(1)</script>',
        timestamp: 1700000005000,
        relativeTimeMs: 5000,
        timecode: '01:00:05:00',
        frameNumber: 300,
        category: 'custom',
        label: 'Dangerous, "Quoted", and \n Newline Text',
        comment: 'Special & <tag> with "double" and \'single\' quotes',
        color: 'Green',
      },
    ];

    it('FCP XML escapes all XML special characters in marker name and comment', () => {
      const xml = exportToFcpXml(emptySession, maliciousMarkers);
      expect(xml).not.toContain('<script>');
      expect(xml).toContain('&lt;script&gt;');
      expect(xml).toContain('&amp; &lt;tag&gt; with &quot;double&quot; and &apos;single&apos;');
    });

    it('CSV escapes commas, quotes, and newlines in label and comment', () => {
      const csv = exportToCsv(emptySession, maliciousMarkers);
      expect(csv).toContain('""Quoted""');
      expect(csv).toContain('"Dangerous, ""Quoted"", and \n Newline Text"');
    });

    it('EDL removes newlines to protect CMX 3600 line structure', () => {
      const edl = exportToEdl(emptySession, maliciousMarkers);
      const lines = edl.split('\r\n');
      const locLine = lines.find((l) => l.startsWith('* LOC:'));
      expect(locLine).toBeDefined();
      expect(locLine).not.toContain('\n');
    });
  });

  describe('YouTube 10-Second Spacing Rule', () => {
    it('throttles chapters occurring within 10 seconds of previous chapter', () => {
      const clusteredMarkers: SquadMarker[] = [
        {
          id: 'c-1',
          roomId: 'room-edge',
          sessionId: 'empty-sess',
          memberId: 'mem-1',
          memberName: 'Pro',
          timestamp: 1700000010000,
          relativeTimeMs: 10000, // 10s
          timecode: '01:00:10:00',
          frameNumber: 600,
          category: 'kill',
          label: 'Kill 1',
          color: 'Red',
        },
        {
          id: 'c-2',
          roomId: 'room-edge',
          sessionId: 'empty-sess',
          memberId: 'mem-1',
          memberName: 'Pro',
          timestamp: 1700000013000,
          relativeTimeMs: 13000, // 13s (only 3s after Kill 1 - should be throttled)
          timecode: '01:00:13:00',
          frameNumber: 780,
          category: 'kill',
          label: 'Kill 2',
          color: 'Red',
        },
        {
          id: 'c-3',
          roomId: 'room-edge',
          sessionId: 'empty-sess',
          memberId: 'mem-1',
          memberName: 'Pro',
          timestamp: 1700000025000,
          relativeTimeMs: 25000, // 25s (15s after Kill 1 - accepted)
          timecode: '01:00:25:00',
          frameNumber: 1500,
          category: 'clutch',
          label: 'Clutch Finish',
          color: 'Yellow',
        },
      ];

      const yt = exportToYouTubeChapters(emptySession, clusteredMarkers);
      expect(yt).toContain('00:00 Start of Stream');
      expect(yt).toContain('00:10 Kill 1');
      expect(yt).not.toContain('00:13 Kill 2'); // skipped due to < 10s interval
      expect(yt).toContain('00:25 Clutch Finish');
    });
  });

  describe('SMPTE Boundary & Large Values', () => {
    const tc = new SMPTETimecode({ framerateNumerator: 60, framerateDenominator: 1 });

    it('handles > 24 hours frame count modulo', () => {
      // 25 hours at 60 fps
      const frames25h = 25 * 3600 * 60;
      const tcStr = tc.framesToTimecode(frames25h);
      expect(tcStr).toBe('01:00:00:00'); // modulo 24 hours
    });

    it('converts frame 0 to 00:00:00:00 and ms 0 to 0', () => {
      expect(tc.framesToMilliseconds(0)).toBe(0);
      expect(tc.millisecondsToFrames(0)).toBe(0);
    });
  });
});
