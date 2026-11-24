# Problem reports ("Something not working?")

Anyone using OverHeard can report a bug without a GitHub account. The form is a few short
steps: pick what went wrong, say what happened and how to make it happen again (both optional),
add private comments or an email for a reply (optional), then check everything and send.

## Where to find it

- **Report a problem** button on the main bar (next to the Guide button) and on student room pages.
- **Something not working?** at the bottom of **Settings** (main bar, Two-way, Lecture, student
  rooms) and of the **Guide & FAQ**.

Opening the form never stops listening, a lecture, or a student room. Keys typed in the form
don't reach the caption shortcuts (Space, Shift) behind it.

## What gets sent where

| Part | Where it goes |
| --- | --- |
| What went wrong, what happened, how to make it happen again, diagnostics | **Public** GitHub issue in `BPMData/overheard`, labeled `user-report`, and the email |
| Other comments, contact email | **Private**: the email only, never the issue |

The last step shows both parts exactly as they will be sent. Nothing is sent until the person
ticks "I checked this. Send it." and presses **Send report**.

Diagnostics are feature and permission status only: app version (the running Cloud Run revision),
browser and major version, operating system, page and view, whether listening is on, whether
speech recognition and pop-out captions are available, microphone permission, translator setting
and the last translator used, on-device translation availability, caption language codes, and
online status. Reports never include audio, captions, transcripts, translations, student
information, room codes, PINs or saved lessons. The server drops any diagnostic it doesn't know,
removes email addresses and phone numbers from the public text, and puts the reporter's words in
plain-text blocks so they can't mention people or embed images.

Every email goes to **overboard.reporting@gmail.com** (the inbox OverBoard uses) with a subject
starting `[OverHeard]`, so OverHeard and OverBoard reports are easy to tell apart. When an issue
was filed, the subject ends with its number and the email links to it.

## When it can't send

If automatic sending isn't set up, the person is offline, or sending fails, the form shows the
same report with **Copy report**, **Download report** and **Open an email** (addressed to the
shared inbox) and asks them to email it there. If the issue was filed but the email failed, it
says the private part didn't go through and offers the same choices for it.

## Setup (owner)

Both delivery paths are optional and independent. With neither, the app runs normally and the
form uses the manual fallback. Set the values as environment variables on the Cloud Run service
`over-heard` (Console → Cloud Run → over-heard → Edit & deploy new revision → Variables &
Secrets). Deploys from GitHub keep them. Secret Manager references work too.

### 1. Public GitHub issues

1. On GitHub: Settings → Developer settings → Fine-grained tokens → Generate new token.
   Resource owner **BPMData**, repository access **Only select repositories → overheard**,
   permission **Issues: Read and write**. Nothing else.
2. In the overheard repository, create the label **user-report** (Issues → Labels) so reports
   are easy to filter.
3. Set `REPORT_GITHUB_TOKEN` to the token. `REPORT_GITHUB_REPO` defaults to `BPMData/overheard`.

The token stays on the server; the browser only ever talks to `/api/report`.

### 2. Private email relay

1. Signed in as **overboard.reporting@gmail.com**, open <https://script.google.com> → New project.
2. Replace the code with [`tools/report-relay.gs`](../tools/report-relay.gs).
3. Project Settings → Script properties → add `RELAY_SECRET` with a long random value.
4. Run `sendTestEmail` once from the editor and allow the permissions it asks for. A test email
   should arrive in the inbox.
5. Deploy → New deployment → Web app. Execute as **Me**, Who has access **Anyone**. Copy the
   `/exec` URL.
6. Set `REPORT_RELAY_URL` to that URL and `REPORT_RELAY_SECRET` to the same secret.

The relay only ever sends to the reporting inbox, whatever a request says, and ignores requests
without the secret. When you change the script, deploy a new version of the same deployment so
the URL stays the same.

This relay was written for OverHeard without OverBoard's relay at hand. If OverBoard's relay is
already deployed from the same account and you'd rather run one, it needs to accept this JSON
body (posted as `text/plain`) and answer `{"ok": true}` after sending:
`{ secret, app, to, subject, text, replyTo, issueUrl }`.

### 3. Check it

- Open `https://<service>/api/report/status`. It shows `"automatic": true` once either path is
  set, plus the running revision.
- Send a test report from the app (pick "Something else", write "Test report"). Check that the
  issue appears with the `user-report` label and the email arrives with any private comment.
- The server log has one `[report]` line per report with only the category, issue number and
  whether the email went. Nothing the reporter wrote is logged.

Each address may send 5 reports per 10 minutes.

Email acknowledgements to the reporter and follow-up when a fix ships are not set up; the form
doesn't promise either.
