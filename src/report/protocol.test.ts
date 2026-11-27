import { describe, expect, it } from 'vitest';
import { normalizeReport, publicIssueBody, publicIssueTitle, reportAsText, scrubPublicText } from './protocol';

describe('problem report protocol', () => {
  it('keeps only known diagnostics and trims every field', () => {
    const report = normalizeReport({
      category: 'read-aloud',
      summary: '  The voice is silent  ',
      diagnostics: { browser: ' Chrome  142 ', roomCode: 'ABCD', pin: '1234', transcript: 'hello' },
      contact: 'x'.repeat(500),
    });
    expect(report?.diagnostics).toEqual({ browser: 'Chrome 142' });
    expect(report?.summary).toBe('The voice is silent');
    expect(report?.steps).toBe('');
    expect(report?.contact).toHaveLength(200);
  });

  it('rejects reports without a known category', () => {
    expect(normalizeReport({ category: 'hack' })).toBeNull();
    expect(normalizeReport(null)).toBeNull();
    expect(normalizeReport('text')).toBeNull();
  });

  it('removes emails and phone numbers from public text but keeps versions and dates', () => {
    expect(scrubPublicText('mail a.b@school.org or call (203) 555-0142')).toBe(
      'mail [email removed] or call [number removed]'
    );
    expect(scrubPublicText('Chrome 142.0.7444.59 on 2026-11-24')).toBe('Chrome 142.0.7444.59 on 2026-11-24');
  });

  it('builds a public issue that cannot ping people or carry private fields', () => {
    const report = normalizeReport({
      category: 'student-room',
      summary: 'Students see nothing @everyone ~~~ ![x](http://evil)',
      comments: 'Private: my class is period 3',
      contact: 'me@example.com',
    })!;
    const body = publicIssueBody(report);
    expect(body).not.toContain('period 3');
    expect(body).not.toContain('me@example.com');
    // User text sits inside a fenced block, and a fence in the text can't close it early
    expect(body).toContain('~~~text\nStudents see nothing @everyone ~~ ![x](http://evil)\n~~~');
    expect(publicIssueTitle(report)).toBe(
      '[User report] Student rooms: Students see nothing @everyone ~~~ ![x](http://evil)'
    );
  });

  it('shortens long titles and works with no description at all', () => {
    const report = normalizeReport({ category: 'other', summary: 'a'.repeat(100) })!;
    expect(publicIssueTitle(report)).toHaveLength('[User report] Something else: '.length + 60);
    expect(publicIssueTitle(normalizeReport({ category: 'other' })!)).toBe('[User report] Something else');
    expect(publicIssueBody(normalizeReport({ category: 'other' })!)).toContain('_Not given._');
  });

  it('puts everything in the private text, with the issue link when there is one', () => {
    const report = normalizeReport({ category: 'translation', comments: 'secret bit', contact: 'me@example.com' })!;
    const text = reportAsText(report, 'https://github.com/BPMData/overheard/issues/1');
    expect(text).toContain('secret bit');
    expect(text).toContain('me@example.com');
    expect(text).toContain('GitHub issue: https://github.com/BPMData/overheard/issues/1');
  });
});
