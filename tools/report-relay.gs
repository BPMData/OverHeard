/**
 * OverHeard problem-report email relay (Google Apps Script).
 *
 * The OverHeard server posts each "Something not working?" report here, and this script emails
 * it to the shared reporting inbox. Deploy it from the reporting Google account so the mail
 * comes from, and lands in, that inbox. Setup steps are in docs/REPORTS.md.
 *
 * Safety: the script only ever sends to INBOX, whatever the request says, so it can't be used
 * to mail anyone else. Requests must carry the shared secret saved in the script's properties.
 */
var INBOX = 'overboard.reporting@gmail.com';
var MAX_BODY = 20000;

function doPost(e) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!secret || data.secret !== secret) return reply_({ ok: false, error: 'unauthorized' });

    var app = String(data.app || 'Unknown app').slice(0, 40);
    var subject = String(data.subject || '').slice(0, 200);
    // Every subject names the app, so OverHeard and OverBoard reports are easy to tell apart.
    if (subject.indexOf('[' + app + ']') !== 0) subject = '[' + app + '] ' + (subject || 'Problem report');
    var body = String(data.text || '').slice(0, MAX_BODY);
    if (!body) return reply_({ ok: false, error: 'empty report' });

    var message = { to: INBOX, subject: subject, body: body, name: app + ' reports' };
    var replyTo = String(data.replyTo || '');
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) message.replyTo = replyTo;
    MailApp.sendEmail(message);
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, error: 'bad request' });
  }
}

/** Run once from the editor to check that mail sending works and to grant permission. */
function sendTestEmail() {
  MailApp.sendEmail({ to: INBOX, subject: '[OverHeard] Relay test', body: 'The OverHeard report relay can send mail.' });
}

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
