import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DOMParser } from '@xmldom/xmldom';
import {
  exportToEdl,
  exportToFcpXml,
  exportToCsv,
  CATEGORY_TO_DAVINCI_COLOR,
  RecordingSession,
  SquadMarker,
  DaVinciMarkerColor,
} from '../src/index.js';

describe('Exporters Conformance & Security Verification', () => {
  const baseSession: RecordingSession = {
    id: 'conformance-sess-1',
    roomId: 'room-conf',
    name: 'Squad Ops: Season 4 & Special Characters',
    startedAt: 1700000000000,
    stoppedAt: 1700003600000, // 1 hour
    baseTimecode: '01:00:00:00',
    framerateNumerator: 60,
    framerateDenominator: 1,
    dropFrame: false,
  };

  describe('EDL CMX 3600 Conformance', () => {
    it('strictly enforces CRLF line endings on every line', () => {
      const markers: SquadMarker[] = [
        {
          id: 'm1',
          roomId: 'room-conf',
          sessionId: baseSession.id,
          memberId: 'mem1',
          memberName: 'StreamerA',
          timestamp: 1700000010000,
          relativeTimeMs: 10000,
          timecode: '01:00:10:00',
          frameNumber: 600,
          category: 'kill',
          label: 'Double Kill',
          color: 'Red',
        },
      ];

      const edl = exportToEdl(baseSession, markers);

      // Entire string must end in \r\n
      expect(edl.endsWith('\r\n')).toBe(true);

      // No lonely \n (every \n must be preceded by \r)
      const invalidLfMatches = edl.match(/[^\r]\n/g);
      expect(invalidLfMatches).toBeNull();

      // Split by CRLF and verify header lines
      const lines = edl.split('\r\n');
      expect(lines[0]).toBe('TITLE: Squad Ops Season 4  Special Characters');
      expect(lines[1]).toBe('FCM: NON-DROP FRAME');
      expect(lines[2]).toBe('');
    });

    it('correctly maps all standard marker categories to DaVinci Resolve colors', () => {
      const categories = Object.keys(CATEGORY_TO_DAVINCI_COLOR);
      const markers: SquadMarker[] = categories.map((cat, idx) => ({
        id: `m-${cat}`,
        roomId: 'room-conf',
        sessionId: baseSession.id,
        memberId: 'mem1',
        memberName: 'Player1',
        timestamp: 1700000000000 + idx * 5000,
        relativeTimeMs: idx * 5000,
        timecode: `01:00:${String(idx * 5).padStart(2, '0')}:00`,
        frameNumber: idx * 300,
        category: cat,
        label: `Event ${cat}`,
      }));

      const edl = exportToEdl(baseSession, markers);

      categories.forEach((cat) => {
        const expectedColor = CATEGORY_TO_DAVINCI_COLOR[cat];
        const tcIn = `01:00:${String(categories.indexOf(cat) * 5).padStart(2, '0')}:00`;
        const event = edl.split('\r\n').findIndex((line) => line.includes(`C        ${tcIn} `));
        expect(event).toBeGreaterThan(0);
        expect(edl.split('\r\n')[event + 1]).toBe(` |C:ResolveColor${expectedColor} |M:Event ${cat} [Player1] |D:1`);
      });
    });

    it('allows explicit custom color overrides in markers', () => {
      const customColors: DaVinciMarkerColor[] = ['Pink', 'Cocoa', 'Mint', 'Sand', 'Lavender'];
      const markers: SquadMarker[] = customColors.map((color, idx) => ({
        id: `custom-${idx}`,
        roomId: 'room-conf',
        sessionId: baseSession.id,
        memberId: 'mem1',
        memberName: 'Director',
        timestamp: 1700000000000 + idx * 2000,
        relativeTimeMs: idx * 2000,
        timecode: `01:00:${String(idx * 2).padStart(2, '0')}:00`,
        frameNumber: idx * 120,
        category: 'note',
        label: `Note with ${color}`,
        color: color,
      }));

      const edl = exportToEdl(baseSession, markers);
      customColors.forEach((color) => {
        expect(edl).toContain(` |C:ResolveColor${color} |M:Note with ${color} [Director] |D:1`);
      });
    });

    it('uses tc.dropFrame for FCM rather than trusting session.dropFrame blindly', () => {
      // 60 fps integer does NOT support dropFrame: tc.dropFrame is false
      const sessionWithMismatch: RecordingSession = {
        ...baseSession,
        framerateNumerator: 60,
        framerateDenominator: 1,
        dropFrame: true, // Invalid for 60 fps NTSC rate
      };

      const edl = exportToEdl(sessionWithMismatch, []);
      expect(edl).toContain('FCM: NON-DROP FRAME');

      // 29.97 fps (30000/1001) DOES support dropFrame: tc.dropFrame is true
      const sessionValidDf: RecordingSession = {
        ...baseSession,
        framerateNumerator: 30000,
        framerateDenominator: 1001,
        dropFrame: true,
      };

      const edlDf = exportToEdl(sessionValidDf, []);
      expect(edlDf).toContain('FCM: DROP FRAME');
    });
  });

  describe('FCP XML Conformance & DOMParser Validation', () => {
    function parseXmlStrict(xmlString: string) {
      const errors: string[] = [];
      const parser = new DOMParser({
        onError: (level, msg) => {
          if (level === 'error' || level === 'fatalError') {
            errors.push(`[${level}] ${msg}`);
          }
        },
      });

      const doc = parser.parseFromString(xmlString, 'text/xml');
      return { doc, errors };
    }

    it('produces 100% valid XML parsed by DOMParser with no errors or unescaped entities', () => {
      const markers: SquadMarker[] = [
        {
          id: 'mk-1',
          roomId: 'room-conf',
          sessionId: baseSession.id,
          memberId: 'mem1',
          memberName: 'Host & Co <Director>',
          timestamp: 1700000010000,
          relativeTimeMs: 10000,
          timecode: '01:00:10:00',
          frameNumber: 600,
          category: 'kill',
          label: 'Epic "Clutch" & Ace <Round 5>',
          comment: 'Special characters: 5 > 3 & 2 < 4 "quotes" and \'apostrophes\'',
          color: 'Red',
        },
      ];

      const xml = exportToFcpXml(baseSession, markers);
      const { doc, errors } = parseXmlStrict(xml);

      expect(errors).toEqual([]);
      expect(doc.documentElement.nodeName).toBe('xmeml');

      const nameEl = doc.getElementsByTagName('name')[0];
      expect(nameEl.textContent).toBe(baseSession.name);

      const markerEls = doc.getElementsByTagName('marker');
      expect(markerEls.length).toBe(1);

      const markerName = markerEls[0].getElementsByTagName('name')[0].textContent;
      expect(markerName).toBe('[KILL] Epic "Clutch" & Ace <Round 5>');

      const markerComment = markerEls[0].getElementsByTagName('comment')[0].textContent;
      expect(markerComment).toContain('Special characters: 5 > 3 & 2 < 4 "quotes" and \'apostrophes\'');
      expect(markerComment).toContain('(By: Host & Co <Director>)');
    });

    it('strips XML control characters (\\x00-\\x1F) preventing DOMParser XML parsing errors', () => {
      const hostileMarkers: SquadMarker[] = [
        {
          id: 'mk-bad',
          roomId: 'room-conf',
          sessionId: baseSession.id,
          memberId: 'mem1',
          memberName: 'Attacker\x00\x08',
          timestamp: 1700000010000,
          relativeTimeMs: 10000,
          timecode: '01:00:10:00',
          frameNumber: 600,
          category: 'custom',
          label: 'Payload\x07\x1b\x0c\x1f-End',
          comment: 'Null\x00Bell\x07Esc\x1bFormFeed\x0cUnitSep\x1f',
        },
      ];

      const hostileSession: RecordingSession = {
        ...baseSession,
        name: 'Session\x01\x02\x03\x04\x05\x06\x1e',
      };

      const xml = exportToFcpXml(hostileSession, hostileMarkers);

      // Control characters must NOT be present in XML
      // eslint-disable-next-line no-control-regex
      expect(xml).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);

      const { doc, errors } = parseXmlStrict(xml);
      expect(errors).toEqual([]);

      const nameEl = doc.getElementsByTagName('name')[0];
      expect(nameEl.textContent).toBe('Session');

      const markerEls = doc.getElementsByTagName('marker');
      expect(markerEls[0].getElementsByTagName('name')[0].textContent).toBe('[CUSTOM] Payload-End');
      expect(markerEls[0].getElementsByTagName('comment')[0].textContent).toBe(
        'NullBellEscFormFeedUnitSep (By: Attacker)'
      );
    });

    it('uses tc.dropFrame in XML <displayformat> (DF vs NDF)', () => {
      const sessionWithMismatch: RecordingSession = {
        ...baseSession,
        framerateNumerator: 60,
        framerateDenominator: 1,
        dropFrame: true, // Unsupported on 60fps
      };

      const xmlNdf = exportToFcpXml(sessionWithMismatch, []);
      const { doc: docNdf, errors: errsNdf } = parseXmlStrict(xmlNdf);
      expect(errsNdf).toEqual([]);
      expect(docNdf.getElementsByTagName('displayformat')[0].textContent).toBe('NDF');

      const sessionValidDf: RecordingSession = {
        ...baseSession,
        framerateNumerator: 30000,
        framerateDenominator: 1001,
        dropFrame: true,
      };

      const xmlDf = exportToFcpXml(sessionValidDf, []);
      const { doc: docDf, errors: errsDf } = parseXmlStrict(xmlDf);
      expect(errsDf).toEqual([]);
      expect(docDf.getElementsByTagName('displayformat')[0].textContent).toBe('DF');
    });

    it('safely handles malformed / XML injection in session.baseTimecode with clean fallback', () => {
      const hostileTimecodeSession: RecordingSession = {
        ...baseSession,
        baseTimecode: '01:00:00:00<evil>\x00\x08</evil>',
      };

      expect(() => exportToFcpXml(hostileTimecodeSession, [])).not.toThrow();
      const xml = exportToFcpXml(hostileTimecodeSession, []);
      const { doc, errors } = parseXmlStrict(xml);
      expect(errors).toEqual([]);

      const stringEls = doc.getElementsByTagName('string');
      expect(stringEls[0].textContent).toBe('01:00:00:00');
    });
  });

  describe('CSV Injection Hardening & Fuzzing', () => {
    it('escapes standard spreadsheet formula triggers (=, +, -, @)', () => {
      const markers: SquadMarker[] = [
        {
          id: 'csv-1',
          roomId: 'room-conf',
          sessionId: baseSession.id,
          memberId: 'm1',
          memberName: '=SUM(A1:A10)',
          timestamp: 1700000000000,
          relativeTimeMs: 0,
          timecode: '01:00:00:00',
          frameNumber: 0,
          category: 'kill',
          label: '+cmd|"/c calc"!A0',
          comment: '-2+3+cmd|',
        },
      ];

      const csv = exportToCsv(baseSession, markers);
      const rows = csv.split('\r\n').filter(Boolean);
      const dataRow = rows[1];

      // Must be prefixed with single quote ' to force text mode in Excel / Sheets
      expect(dataRow).toContain("'=SUM(A1:A10)");
      expect(dataRow).toContain('\'+cmd|""/c calc""!A0');
      expect(dataRow).toContain("'-2+3+cmd|");
    });

    it('escapes pipe trigger | and leading whitespace before formula characters', () => {
      const markers: SquadMarker[] = [
        {
          id: 'csv-pipe',
          roomId: 'room-conf',
          sessionId: baseSession.id,
          memberId: 'm1',
          memberName: '|cmd.exe',
          timestamp: 1700000000000,
          relativeTimeMs: 0,
          timecode: '01:00:00:00',
          frameNumber: 0,
          category: 'note',
          label: '   =1+1',
          comment: '  |powershell.exe -c "notepad"',
        },
      ];

      const csv = exportToCsv(baseSession, markers);
      const rows = csv.split('\r\n').filter(Boolean);
      const dataRow = rows[1];

      expect(dataRow).toContain("'|cmd.exe");
      expect(dataRow).toContain("'   =1+1");
      expect(dataRow).toContain('\'  |powershell.exe -c ""notepad""');
    });

    it('fuzzes CSV fields with arbitrary whitespace and formula combinations (fast-check)', () => {
      const formulaChars = ['=', '+', '-', '@', '|'];
      const whitespaceChars = [' ', '  ', '\t', '   \t'];

      fc.assert(
        fc.property(
          fc.constantFrom(...formulaChars),
          fc.constantFrom(...whitespaceChars),
          fc.stringMatching(/^[a-z0-9]{1,20}$/),
          (prefix, ws, rest) => {
            const dangerousPayload = `${ws}${prefix}${rest}`;
            const marker: SquadMarker = {
              id: 'fuzz-m',
              roomId: 'room-conf',
              sessionId: baseSession.id,
              memberId: 'm1',
              memberName: 'Fuzzer',
              timestamp: 1700000000000,
              relativeTimeMs: 1000,
              timecode: '01:00:01:00',
              frameNumber: 60,
              category: 'note',
              label: dangerousPayload,
              comment: dangerousPayload,
            };

            const csvOutput = exportToCsv(baseSession, [marker]);
            // Output must contain the sanitized payload beginning with single quote '
            expect(csvOutput).toContain(`'${dangerousPayload}`);
            return true;
          }
        ),
        { numRuns: 300 }
      );
    });

    it('does not prepend quote to harmless regular text or numbers', () => {
      const benignMarker: SquadMarker = {
        id: 'benign-1',
        roomId: 'room-conf',
        sessionId: baseSession.id,
        memberId: 'm1',
        memberName: 'Alex Player',
        timestamp: 1700000000000,
        relativeTimeMs: 5000,
        timecode: '01:00:05:00',
        frameNumber: 300,
        category: 'kill',
        label: 'Great Headshot',
        comment: 'Regular comment without formulas',
      };

      const csv = exportToCsv(baseSession, [benignMarker]);
      expect(csv).toContain('Alex Player');
      expect(csv).not.toContain("'Alex Player");
      expect(csv).toContain('Great Headshot');
      expect(csv).not.toContain("'Great Headshot");
      expect(csv).toContain('Regular comment without formulas');
      expect(csv).not.toContain("'Regular comment without formulas");
    });

    it('safely handles NaN and non-finite timestamps without throwing RangeError', () => {
      const invalidMarker: SquadMarker = {
        id: 'nan-time',
        roomId: 'room-conf',
        sessionId: baseSession.id,
        memberId: 'm1',
        memberName: 'Alex Player',
        timestamp: NaN as any,
        relativeTimeMs: 5000,
        timecode: '01:00:05:00',
        frameNumber: 300,
        category: 'kill',
        label: 'NaN Timestamp Marker',
      };

      expect(() => exportToCsv(baseSession, [invalidMarker])).not.toThrow();
      const csv = exportToCsv(baseSession, [invalidMarker]);
      expect(csv).toContain('NaN Timestamp Marker');
    });
  });
});
