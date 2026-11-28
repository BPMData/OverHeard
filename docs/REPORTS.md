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
| What went wrong, what happened, how to make it happen again, diagnostics | **Public** GitHub issue in `BPMData/OverHeard`, labeled `user-report`, and the email |
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

Every email goes to **overboard.reporting@gmail.com** (the inbox OverBoard, AllAboard and AllHail
use too) with a subject starting `[OverHeard]`, so the apps' reports are easy to tell apart. When
an issue was filed, the subject ends with its number and the email links to it.

## When it can't send

If automatic sending isn't set up, the person is offline, or sending fails, the form shows the
same report with **Copy report**, **Download report** and **Open an email** (addressed to the
shared inbox) and asks them to email it there. If the issue was filed but the email failed, it
says the private part didn't go through and offers the same choices for it.

## How it is delivered

OverHeard uses the **shared report relay**: OverBoard's Google Apps Script web app
(`tools/report-relay.gs` in [BPMData/OverBoard](https://github.com/BPMData/OverBoard)), running
under the reporting Gmail account. AllAboard and AllHail send their reports through the same relay.

1. The browser posts the report to this server's `/api/report`. It never sees a credential.
2. The server checks it, writes the public issue text and the private email text, and posts
   both to the relay with OverHeard's shared secret:
   `{ app: "OverHeard", kind: "problem-report", token, issue: { title, body, labels }, email: { subject, body, replyTo? } }`
   (as `text/plain`, following the Apps Script redirect). Only `email` holds contact details or
   private comments.
3. The relay checks the secret against its `OVERHEARD_TOKEN` script property, opens the issue in
   `BPMData/OverHeard` with its own GitHub token, emails the inbox, and answers
   `{ ok, issue, url, emailed }`. OverHeard holds no GitHub token.

The relay's limits are shared by all four apps: 20 reports an hour and 40 a day in total.

## Settings (owner)

Two environment variables on the Cloud Run service `over-heard`, both from **Secret Manager** in
project `loyal-rookery-403218`:

| Variable | Secret |
| --- | --- |
| `REPORT_RELAY_URL` | `overheard-report-relay-url` (the relay's `/exec` URL) |
| `REPORT_RELAY_SECRET` | `overheard-report-relay-secret` (the same value as the relay's `OVERHEARD_TOKEN`) |

`deploy.yml` attaches them on every deploy with `--set-secrets`, and runs the service as
`overheard-run@loyal-rookery-403218.iam.gserviceaccount.com`, which may read only these two
secrets. Don't set them in the Cloud Run console. To change one, add a new version of the secret;
the next deploy picks it up. With either missing, the app runs normally and the form uses the
manual fallback.

The relay's own setup (its GitHub token, script properties, and publishing a new version) is
documented with the relay in OverBoard.

### 3. Check it

- Open `https://<service>/api/report/status`. It shows `"automatic": true` once both settings are
  there, plus the running revision. The deploy's last check fails if it isn't.
- Send a test report from the app (pick "Something else", write "Test report"). Check that the
  issue appears with the `user-report` label and the email arrives with any private comment.
- The server log has one `[report]` line per report with only the category, issue number and
  whether the email went. Nothing the reporter wrote is logged.

Each address may send 5 reports per 10 minutes.

Email acknowledgements to the reporter and follow-up when a fix ships are not set up; the form
doesn't promise either.
