# P.A.N.D.A.

ADSC’s animated workshop mascot. Members submit questions in Discord, officers approve them, and the presenter chooses when Panda reads them aloud. Google Forms greetings remain available before the lecture.

This first desktop build runs locally on **macOS with Node.js 22.13 or newer**. It opens an operator console and a floating Panda overlay. No hosting subscription is needed; keep the laptop awake and online for Discord. Native Mac speech has no API charge. OpenAI speech, greetings, and optional AI drafts use your own billed API key.

## Install and launch

Clone or download this repository, open a terminal in its folder, then:

```sh
npm ci
cp .env.example .env
npm run desktop
```

**Keep an existing `.env`; do not overwrite it.** `npm run desktop` builds the code and starts Electron plus the local server. Quit the app before rebuilding. This is a development desktop build, not a packaged installer yet.

For browser development use `npm run dev`, then open `http://localhost:5173/workshop`. A browser preview cannot float over other apps. `npm run build` followed by `npm start` serves the built browser version at `http://localhost:3001/workshop`.

## Try it without Discord or paid keys

1. Keep `DEMO_MODE=true` and `ENABLE_DISCORD_QA=false` in `.env`.
2. Run `npm run desktop`. Click **Start workshop**.
3. On the Panda window, click **Enable playback**. Drag Panda itself to move it. Hover over Panda for **− / +** size buttons, or use **Smaller / Larger** in the admin panel. Transparent space passes clicks through to the presentation.
4. Expand **Test without Discord**, add a question, then **Approve** it. Nothing should play yet.
5. Click **Start lecture**. Select **Mac system voice**, then **Read next question**.
6. After Panda finishes, the question becomes **read**. Answer it yourself and click **Mark answered**.

**Stop speaking** interrupts the current question; **Queue again** makes it eligible for another explicit release. Only one question plays at a time. Ending, replacing, or restarting a workshop marks pending, approved, playing, and interrupted questions **Workshop ended**. Their cards stay in history, but cannot be approved or replayed. Click **Start workshop** for a fresh queue; reopening old workshops is no longer needed. Read, answered, and denied history is preserved.

## Discord setup

Use a separate test bot if you cannot change the officer’s existing application or another process is using it. A token shared in chat should be replaced by the bot owner. Put tokens directly in your local `.env`, never in Discord messages or source files.

### Create or reuse the application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Create an application named P.A.N.D.A. Test, or open the officer’s application if you have access.
2. Copy its **Application ID** from **General Information**. Under **Bot**, obtain/reset its token and paste it directly into `.env`.
3. This app receives interactions through Discord’s Gateway. Leave **Interactions Endpoint URL** empty. If an existing bot needs its HTTP endpoint or existing `/ask` command, create a separate bot instead. Stop any other process running this same bot.
4. Install the bot into the ADSC server using a **Guild Install** link with `bot` and `applications.commands` scopes. In the question channel, grant it **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History**. Server installation requires an authorized server member. Administrator permission is unnecessary.
5. No privileged intents are needed (including for commands-only cleanup): leave **Message Content**, **Server Members**, and **Presence** intents off. Members need access to the question channel and **Use Application Commands** permission.
6. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click the server and question channel to copy their IDs. Under server roles, copy the officer role ID. Anyone approving in Discord must actually have that role.

Fill these local settings (a new bot requires its own application ID and token):

```dotenv
ENABLE_DISCORD_QA=true
DISCORD_BOT_TOKEN=your_token_here
DISCORD_APPLICATION_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
DISCORD_QUESTION_CHANNEL_ID=your_question_channel_id
DISCORD_MODERATOR_ROLE_IDS=your_officer_role_id
DISCORD_MODERATION_CHANNEL_ID=
DISCORD_COMMANDS_ONLY=false
```

Multiple moderator role IDs can be comma-separated. The optional moderation channel must be private to officers and accessible to the bot; it receives review cards. Without it, officers use `/review` for private approval buttons, or approve in the local console. Ordinary channel messages are not ingested: members use `/ask`.

### Connect and verify

1. Restart the app after editing `.env`. Click **Connect**, then **Update commands**. Registration also adds `/review`. Other commands are preserved; a conflicting existing command is refused.
2. Start a workshop. In the configured channel, run `/ask` and fill in its inline fields: `question`, `name`, and optional `anonymous`. Name and question are required. Set anonymous to Yes to keep your entered name out of spoken playback; your Discord account is still visible on the public card. Expect a short private confirmation, a public question card marked **Pending approval**, and a pending item in the console.
3. As an officer, run `/review` and approve it. Each question has its own **Approve**, **Deny**, and **Manual answer** controls where applicable. Up to ten reviewable questions are shown at a time; run the command again after reviewing those to see more. Check that the original public card changes to **Approved** without speaking. The card stays in channel history and also reflects later playback/answered status. Desktop-console reviews update it within about five seconds. A member without the configured role must be denied approval access.
4. Enable overlay playback, switch to lecture, and click **Read next question**. Panda should announce the submitted name and read the question, without generating an answer.
5. Test **Deny**, **Stop speaking**, **Queue again**, and **End workshop**. After ending, `/ask` must say no workshop is active. Restart once and reconnect Discord to confirm old unfinished cards become **Workshop ended**.

If `/ask` is missing, check the application/server IDs, installation scopes, registration result, and channel command permissions. Reopen Discord if necessary. If it times out, confirm this laptop is online, the console says connected, and no competing bot process or HTTP interaction endpoint is handling it.

### Upgrading an existing bot

Quit the desktop app, run `npm run desktop`, **Connect**, then click **Update commands** once. This updates `/ask` with inline fields and replaces this app’s old `/panda-review` with `/review`. Unrelated commands are preserved. If Discord still shows the old fields, dismiss the command picker and reopen Discord.

Public card headings use the entered name (for example, **Anshul asked**), or **Anonymous asked** when anonymous is selected. The authenticated Discord account stays tagged underneath. Officer review cards also show the entered name and question. `anonymous: true` hides the entered name from the public card and **spoken playback**: Panda says “A member asks…”; otherwise it reads the entered name. Existing question records are preserved; public cards are created for new Discord submissions after this update.

### Reply manually as an officer

Run `/review`, find the question, and click **Manual answer**. Enter up to 1,500 characters and submit. The bot posts your response in the question channel, credits your server display name (falling back to your Discord display name or username) without mentioning you, tags only the asker, and marks the question **Answered**, removing it from the speech queue. These bot messages survive commands-only cleanup. Pending, approved, read, and interrupted questions can be answered; a question currently playing cannot.

Officer permissions are checked again when submitting the response. Answers are saved locally and delivery retries if Discord is unavailable. This is a written response, not TTS. Existing public question headings refresh when the upgraded bot connects. `/ask` keeps the order **question → name → anonymous**.

### Keep the channel for questions

Discord requires members to have both **Send Messages** and **Use Application Commands** for slash commands ([Discord’s explanation](https://github.com/discord/discord-api-docs/discussions/5097)). Keep those enabled, along with **View Channel** and **Read Message History**.

To remove ordinary messages automatically:

1. Give the bot **Manage Messages** in this question channel.
2. Add `DISCORD_COMMANDS_ONLY=true` to `.env` and restart/reconnect.
3. Test with an ordinary member: `/ask` should work and a regular message should be removed. Cleanup applies to new human messages in this channel, including officers; bot cards are preserved. It needs the bot online, may briefly show messages before removing them, and does not erase old history.

No Message Content intent is needed. To disable cleanup, set the option to `false` and restart. You can additionally restrict other apps’ commands under **Server Settings → Integrations**.

Suggested channel topic (or pin a message before enabling cleanup):

> Workshop questions: use /ask and fill in your question. Enter your name; choose anonymous: Yes if you do not want it read aloud. Your Discord account remains visible. Officers: use /review to approve or deny. Question cards show their status here. Please keep general chat in the other channels.

Pending questions are public before review, as requested. Denying one marks its card **Not approved**; it does not remove its text. Officers can delete inappropriate cards using Discord’s normal moderation controls.

### Pause questions and prevent spam

Starting a workshop opens question submissions; ending it, restarting the server, or reaching the six-hour expiry closes them. Officers can use `/review action:lock` or `/review action:unlock` during an active workshop. The desktop console also has **Lock questions / Unlock questions**. This pauses `/ask` intake; it does not change Discord channel permissions or interrupt a question already playing. Officers can still review the existing queue while intake is paused. Unlocking cannot start an inactive workshop remotely.

Each Discord account can submit at most once every 15 seconds and hold at most three pending/approved questions. Names and questions are length-limited, normalized, and checked for common profanity. Name fields reject URLs, mentions, and non-name punctuation. This basic filter cannot detect every offensive phrase or disguised spelling; officers still decide what gets read. Public cards escape formatting and suppress notification mentions.

When Panda is fully offline, Discord shows its own non-response error for `/ask`; custom replies require a running bot or hosted endpoint. Add “Panda is available only during workshops” to the channel topic.

The connected bot can remain online between workshops while the desktop app runs, even with Panda hidden. Closed workshops reject new questions. Closing the app or sleeping/shutting down the laptop takes the bot offline; always-on availability would require a separate continuously running host.

## Workshop routine

1. Launch the app and start a new workshop. This starts greeting mode; it does not modify the Form or spreadsheet.
2. Enable playback on the overlay. Use **Next display** to place it on the projector. Rehearse with the actual slides in fullscreen before the audience arrives; display/Space behavior depends on the presentation setup.
3. Connect Discord. Register commands only on first setup or after command changes.
4. Use **Greeting settings** to check live sign-ins and greeting voices. Keep the old projector closed so it does not compete for audio ownership.
5. Click **Start lecture**. Officers approve questions; the presenter releases them during pauses. Approval never interrupts the lecture.
6. Click **End workshop** when finished. Unfinished public cards update to **Workshop ended** within about five seconds while connected. Sessions also expire after six hours. If the app crashes or quits before updating Discord, cards are repaired on the next app launch and bot connection; a stopped bot cannot update messages. Quit the app to disconnect the bot.

Shortcuts: **⌘⇧P** shows/hides Panda; **⌘⇧O** opens the operator console. Hiding Panda does not stop speech; use **Stop speaking**. Audio uses the computer’s selected output device.

## Optional OpenAI and Google configuration

Set `OPENAI_API_KEY` for greetings, OpenAI question speech, or private AI drafts. A ChatGPT subscription does not supply API credit. Question speech uses `TTS_MODEL` and `TTS_VOICE`. The optional private draft panel supports model selection and web search; drafts are currently text-only and never posted to Discord. Model access depends on your API account.

## Connect a new workshop Form

Panda reads the normal Google Form response tab directly. It only uses the name and timestamp columns. It does not write to Google, build member profiles, or import previous workshops.

### One-time Google access

1. Enable **Google Sheets API** in your Google Cloud project.
2. Reuse your existing service-account JSON key, or create a service account and download its JSON key. Keep the key outside the repository.
3. Set `GOOGLE_SERVICE_ACCOUNT_FILE` in your local `.env` to its absolute file path. Keep `OPENAI_API_KEY` configured for spoken greetings.

### For each new workshop

1. Create the Google Form. Include a **required short-answer name question** (a name the attendee is comfortable hearing aloud). Any other questions are fine; their order and number do not matter to Panda.
2. In the Form's **Responses** tab, choose **Link to Sheets** and create/select a spreadsheet. Submit one test response if necessary to confirm the headers.
3. Share that spreadsheet with the `client_email` from your service-account JSON as **Viewer**. It does not need Editor access or public sharing.
4. Copy the spreadsheet ID from `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`. Use the spreadsheet ID, not the Form ID.
5. Copy the response tab name and the name question's header from row 1. Update your local `.env`:

```dotenv
DEMO_MODE=false
GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/path/to/service-account.json
GREETINGS_SPREADSHEET_ID=your_new_spreadsheet_id
GREETINGS_SHEET_NAME="Form Responses 1"
GREETINGS_NAME_HEADER="What's your full name?"
GREETINGS_TIMESTAMP_HEADER="Timestamp"
```

Use your actual name question, not necessarily the example. Capitalization and punctuation must match. Leading/trailing whitespace and differences in spaces/newlines are normalized. For a localized sheet, map the actual timestamp header too. Both mapped headers must be unique. Questions not mapped here are ignored, including email, prizes, major, and feedback; they do not personalize the greeting automatically.

6. Quit the app and any separately running Panda server; run `npm run desktop`. Open **Greeting settings** and wait for Sheets to say **Synced**. A header mismatch or permission error appears there.
7. Click **Start workshop** and **Enable playback** on Panda. Keep automatic greetings enabled. Submit a **new** Form response after the successful sync. Expect a named greeting in a few seconds; speech needs your OpenAI API key and working audio output.
8. Click **Start lecture** to stop greetings and use the Discord question queue. Responses still reach Google normally. End the workshop when finished.

### Important behavior

- Every app/server startup silently baselines existing responses. Only submissions detected after the first successful sync greet. Start and verify syncing before attendees sign in; restarting does not replay the old sheet.
- A test submitted before launch is intentionally silent. Submit again after sync to verify playback. Use **Replay last welcome** to replay the most recent queued greeting.
- A new submission gets a new greeting even if the person used the same name before. This is response-based, not a member database. Avoid editing names/timestamps or deleting responses during the session; changes to identifying cells may look like new submissions.
- Rows missing a name or timestamp are skipped. Polling retries temporary failures; submissions added during a temporary outage after the baseline are picked up on recovery.
- While automatic greetings are off, newly detected responses are skipped rather than queued for a later lecture interruption.
- No Apps Script, form-submit trigger, repair trigger, private schema, session ID, or historical import is required. If reusing the old spreadsheet, remove its old `onFormSubmit` and `repairLiveSubmissions` triggers in Apps Script → Triggers so the old script stops writing auxiliary data. Removing code locally does not uninstall cloud triggers. Existing Google data is not deleted by this change.
- Remove obsolete `PRIVATE_*`, `SESSION_ID`, `SESSION_NAME`, `GITHUB_TOKEN`, and `ENABLE_GITHUB_ENRICHMENT` settings from `.env` when convenient. They are no longer used. Keep your Google and OpenAI credentials.

## Maintenance

- Run `npm test` and `npm run build` to check changes. An experimental SQLite warning on Node 22 is expected.
- Queue data lives in `.local-data/workshop.sqlite` (excluded from Git). Restart does not erase it. `PANDA_DATA_DIR` can select a different local folder.
- `.env`, credentials, and local member data must stay private. Never expose this local operator server publicly.
- The original projector (`/`) and admin (`/admin`) remain available for the earlier voice Q&A workflow.
- Greetings read a standard Form response tab. Grouped/personalized greetings from extra answers, installer packaging, and further animation polish are follow-up work.
