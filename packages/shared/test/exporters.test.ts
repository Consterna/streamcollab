import { describe, it, expect } from 'vitest';
import {
  RecordingSession,
  SquadMarker,
  SquadMember,
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  exportToYouTubeChapters,
  generateMulticamSyncMatrix,
} from '../src/index.js';

const mockSession: RecordingSession = {
  id: 'sess-123',
  roomId: 'room-alpha',
  name: 'Grand Final Match 1',
  startedAt: 1700000000000,
  stoppedAt: 1700000600000, // 10 minutes
  baseTimecode: '01:00:00:00',
  framerateNumerator: 60,
  framerateDenominator: 1,
  dropFrame: false,
};

const mockMarkers: SquadMarker[] = [
  {
    id: 'm-1',
    roomId: 'room-alpha',
    sessionId: 'sess-123',
    memberId: 'mem-1',
    memberName: 'Shroud',
    timestamp: 1700000015000, // +15s
    relativeTimeMs: 15000,
    timecode: '01:00:15:00',
    frameNumber: 900,
    category: 'kill',
    label: 'First Blood',
    comment: 'Pistol headshot',
    color: 'Red',
  },
  {
    id: 'm-2',
    roomId: 'room-alpha',
    sessionId: 'sess-123',
    memberId: 'mem-2',
    memberName: 'Tarik',
    timestamp: 1700000120000, // +120s
    relativeTimeMs: 120000,
    timecode: '01:02:00:00',
    frameNumber: 7200,
    category: 'wipe',
    label: 'Ace 1v5',
    comment: 'Insane smoke spray',
    color: 'Fuchsia',
  },
];

const mockMembers: SquadMember[] = [
  {
    id: 'mem-1',
    name: 'Shroud',
    role: 'player',
    obsStatus: 'recording',
    fps: 60,
    outputDurationMs: 600000,
    clockOffsetMs: -2.5,
    rttMs: 8.2,
    lastHeartbeat: 1700000600000,
  },
  {
    id: 'mem-2',
    name: 'Tarik',
    role: 'player',
    obsStatus: 'recording',
    fps: 59.94,
    outputDurationMs: 599800,
    clockOffsetMs: 5.1,
    rttMs: 12.0,
    lastHeartbeat: 1700000600000,
  },
];

describe('NLE Exporters', () => {
  describe('DaVinci Resolve CMX 3600 EDL', () => {
    it('generates strictly formatted EDL with CRLF line endings', () => {
      const edl = exportToEdl(mockSession, mockMarkers);

      // Verify CRLF line endings
      expect(edl.includes('\r\n')).toBe(true);
      expect(edl.endsWith('\r\n')).toBe(true);

      // Verify title & FCM headers
      expect(edl).toContain('TITLE: Grand Final Match 1');
      expect(edl).toContain('FCM: NON-DROP FRAME');

      // Verify event 001 and 002
      expect(edl).toContain('001  AX       V     C        01:00:15:00 01:00:15:01 01:00:15:00 01:00:15:01');
      expect(edl).toContain('* LOC: 01:00:15:00 Red First Blood [Shroud] - Pistol headshot');

      expect(edl).toContain('002  AX       V     C        01:02:00:00 01:02:00:01 01:02:00:00 01:02:00:01');
      expect(edl).toContain('* LOC: 01:02:00:00 Fuchsia Ace 1v5 [Tarik] - Insane smoke spray');
    });
  });

  describe('Adobe Premiere Pro FCP 7 XML', () => {
    it('generates compliant xmeml XML with video format characteristics and marker tags', () => {
      const xml = exportToFcpXml(mockSession, mockMarkers, { width: 1920, height: 1080 });

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<xmeml version="4">');
      // Duration must be 36000 frames (10 mins @ 60fps), NOT 252000 (which would have added 1 hour base timecode)
      expect(xml).toContain('<duration>36000</duration>');
      expect(xml).toContain('<timebase>60</timebase>');
      expect(xml).toContain('<width>1920</width>');
      expect(xml).toContain('<height>1080</height>');
      expect(xml).toContain('<name>[KILL] First Blood</name>');
      expect(xml).toContain('<comment>Pistol headshot (By: Shroud)</comment>');
      expect(xml).toContain('<in>900</in>');
      expect(xml).toContain('<out>901</out>');
      expect(xml).toContain('<name>[WIPE] Ace 1v5</name>');
      expect(xml).toContain('<comment>Insane smoke spray (By: Tarik)</comment>');

      // Verify track does not contain markers (markers must be on sequence level)
      expect(xml).toContain('<track>\n          <enabled>TRUE</enabled>\n          <locked>FALSE</locked>\n        </track>');
    });
  });

  describe('Universal CSV Exporter', () => {
    it('generates standard RFC 4180 CSV with quotes escaping', () => {
      const csv = exportToCsv(mockSession, mockMarkers);

      expect(csv).toContain('Marker ID,Timestamp (UTC),Timecode,Frame,Relative Time (ms),Category,Creator,Label,Comment,Color,Session ID');
      expect(csv).toContain('01:00:15:00,900,15000,KILL,Shroud,First Blood,Pistol headshot,Red,sess-123');
      expect(csv).toContain('01:02:00:00,7200,120000,WIPE,Tarik,Ace 1v5,Insane smoke spray,Fuchsia,sess-123');
    });
  });

  describe('YouTube Chapters Exporter', () => {
    it('includes automatic 00:00 chapter and clean description timestamps', () => {
      const yt = exportToYouTubeChapters(mockSession, mockMarkers);

      // YouTube description requires 00:00 start
      expect(yt).toContain('00:00 Start of Stream');
      expect(yt).toContain('00:15 First Blood - Pistol headshot');
      expect(yt).toContain('02:00 Ace 1v5 - Insane smoke spray');
    });
  });

  describe('Multicam Sync Matrix JSON', () => {
    it('computes member session alignments and sync matrix', () => {
      const matrix = generateMulticamSyncMatrix(mockSession, mockMarkers, mockMembers);

      expect(matrix.sessionId).toBe('sess-123');
      expect(matrix.members.length).toBe(2);

      const shroud = matrix.members.find((m) => m.name === 'Shroud');
      expect(shroud).toBeDefined();
      expect(shroud?.fps).toBe(60);
      expect(shroud?.sessionOffsetMs).toBe(-2.5);

      const tarik = matrix.members.find((m) => m.name === 'Tarik');
      expect(tarik).toBeDefined();
      expect(tarik?.fps).toBe(59.94);
      expect(tarik?.sessionOffsetMs).toBe(5.1);
      expect(matrix.markers.length).toBe(2);
    });

    it('aligns 29.97 fps member with exact rational timecode and non-drift frame calculations', () => {
      const ntscMember: SquadMember = {
        id: 'mem-ntsc',
        name: 'RetroCam',
        role: 'player',
        obsStatus: 'recording',
        fps: 29.97,
        outputDurationMs: 60000,
        clockOffsetMs: 100.1,
        rttMs: 15.0,
        lastHeartbeat: 1700000600000,
      };

      const matrix = generateMulticamSyncMatrix(mockSession, mockMarkers, [ntscMember]);
      expect(matrix.members[0].fps).toBe(29.97);
      expect(matrix.members[0].sessionOffsetMs).toBe(100.1);
      // 100.1ms at 29.97 (30000/1001) fps = 100.1 * 30000 / 1001000 = 3 frames
      expect(matrix.members[0].sessionOffsetFrames).toBe(3);
    });
  });
});
