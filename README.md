# P.A.N.D.A.

Aggie Data Science Club's voice mascot: personalized welcomes, spoken Q&A, an animated panda, and captions. Run it locally on the laptop connected to your projector. Internet is needed for voice and live data.

## 1. Download and install

Install **Node.js 22 or newer** (includes npm). Clone this repository or download its ZIP and extract it. Open a terminal in the project folder, then run:

```sh
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

## 2. Add your configuration

Open `.env` in your editor. This is a local file and is excluded from Git.

| Setting | What you need |
| --- | --- |
| `OPENAI_API_KEY` | An OpenAI API project key with billing and access to the configured models. Required for voice greetings and Q&A. A ChatGPT subscription alone does not supply API credit. |
| `DEMO_MODE` | Keep `true` to try fictional members without connecting Google. Use `false` for the club's real sign-ins. |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | For live data: the absolute path to a Google service-account JSON credential on your computer. |
| `PRIVATE_SPREADSHEET_ID` | For live data: the private workbook ID, found between `/d/` and `/edit` in its URL. |
| `SESSION_ID` | For live data: must exactly match `session_id` in the workbook's `Config` tab. |
| `GITHUB_TOKEN` | Optional, for authenticated public GitHub API reads. Leave blank and set `ENABLE_GITHUB_ENRICHMENT=false` if you do not need GitHub enrichment. |

Keep the remaining defaults initially. `REALTIME_MODEL` handles spoken Q&A, `TTS_MODEL` handles greetings, and `WEB_SEARCH_MODEL` handles optional current-information searches. Set `ENABLE_WEB_SEARCH=false` if you do not need search. Use lowercase `true` and `false` for boolean settings.

For a quick voice demo, only fill in `OPENAI_API_KEY`, keep `DEMO_MODE=true`, and disable the optional integrations if unused. Without an OpenAI key, you can still preview animations and visual welcomes.

### Connecting to the existing club Sheets setup

Ask the project owner for the private spreadsheet ID, current session ID, and authorized Google service-account access. The Google Sheets API must be enabled in the service account's Cloud project, and the private workbook must be shared with the service account's email as **Editor**.

Example local configuration (replace these values):

```dotenv
DEMO_MODE=false
GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/path/to/service-account.json
PRIVATE_SPREADSHEET_ID=your_private_workbook_id
SESSION_ID=the_current_session_id
```

The existing workbook uses `Members`, `SessionSignIns`, and `EnrichmentCache`. The club's Apps Script and Form trigger are already configured: **do not rerun historical imports or reinstall triggers just to run this app on another laptop.** Confirm with the operator that `session_active` is enabled in `Config` before collecting sign-ins. Leave existing session codes and counters alone.

This assumes access to the club's existing workbook. A separate installation needs its own compatible Sheets/Form setup; simply linking an arbitrary spreadsheet will not work.

## 3. Run locally

For development and testing:

```sh
npm run dev
```

- Projector: **http://localhost:5173**
- Admin: **http://localhost:5173/admin**

Code changes reload automatically. Restart the command after changing `.env`. Stop it with **Ctrl+C**.

For a workshop, stop the development server and run:

```sh
npm run build
npm start
```

- Projector: **http://localhost:3001**
- Admin: **http://localhost:3001/admin**

This runs the built version. Repeat `npm run build` after code changes. The port does not select demo/live data; `DEMO_MODE` does.

## 4. Start a session

1. Open admin and projector in separate windows. Keep the projector window open.
2. Click **Enable stage audio** on the projector. Allow microphone access in your browser (and your operating system if prompted).
3. In admin, choose **Arrival mode**. For a demo, click **Simulate arrival**; for live use, submit the club's sign-in form.
4. Switch to **Q&A mode**, wait for **Ready for a question**, and say: “Hi Panda, my code is Panda one. What project should I build?”
5. Wait until Panda finishes before a follow-up. The microphone is temporarily disabled during its response.

Greeting and Q&A voices can be changed in admin. Keep **Animation rehearsal → Automatic** during real use. Existing sign-ins load silently after a server restart; use **Greet attendee** or **Replay last welcome** to test again without resubmitting the form.

## Troubleshooting and team changes

- **No voice:** check the OpenAI key, API billing/model access, stage audio, and speaker output. Use **Reconnect voice** after fixing configuration.
- **No microphone:** check browser/OS permissions and the selected input in admin.
- **No live arrivals:** check `DEMO_MODE=false`, spreadsheet access, matching session ID, and the admin Sheets status.
- **Port already in use:** stop the other local server before starting another copy.
- **Changing personality:** edit `server/src/config/personality.ts` and reconnect voice. Greeting templates are in `shared/domain.ts`.
- **Checking code changes:** run `npm test` and `npm run build`.

Keep `.env`, Google credential JSON files, tokens, and member exports private. `.env.example` contains placeholders for sharing. Run the admin/projector locally; this app is not configured as a public, authenticated service.
