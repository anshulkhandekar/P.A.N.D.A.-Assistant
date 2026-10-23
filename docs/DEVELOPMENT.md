# Development

## Environment

Use Node 22.13+; `.nvmrc` selects the Node 22 release line. Install from the lockfile with `npm ci`. Copy `.env.example` only when no local `.env` exists.

The primary desktop target is macOS. Linux CI validates TypeScript, tests, builds, and the HTTP server; it does not establish Linux desktop or native speech compatibility. No paid API keys or Discord credentials are needed for automated checks.

## Commands

| Command                | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Watched Node server and Vite client     |
| `npm run desktop`      | Build, then launch Electron             |
| `npm run build`        | Typecheck and compile client/server     |
| `npm start`            | Serve the existing build                |
| `npm test`             | Run Vitest once                         |
| `npm run typecheck`    | Check TypeScript without emitting files |
| `npm run format`       | Apply repository formatting             |
| `npm run format:check` | Verify formatting without changes       |
| `npm run check`        | Formatting, tests, and build            |
| `npm run smoke`        | Build and run isolated HTTP/SSE checks  |

Browser development: `http://localhost:5173/workshop`. Built server: `http://localhost:3001/workshop`. If changing the backend port, also update the Vite proxy. Electron may reuse an existing server, so stop old processes before testing a different build.

## Navigation

- `client/src/workshop/WorkshopConsole.tsx`: current presenter UI.
- `client/src/workshop/WorkshopStage.tsx`: floating mascot and question playback.
- `client/src/pages/ProjectorApp.tsx`: original projector and detailed greeting/voice controls.
- `server/src/workshop.ts`: workshop API and speech-provider orchestration.
- `server/src/services/WorkshopStore.ts`: persistence and permitted state transitions.
- `server/src/services/DiscordWorkshop.ts`: interaction handlers and delivery synchronization.
- `shared/domain.ts`: greeting templates shared by the original projector and TTS.

Keep integrations in services, queue invariants in the store, and renderer animation/audio responsibilities in the client. Extend the preload contract in both `desktop/preload.cjs` and `client/src/desktop.d.ts` when adding desktop capabilities.

## Validation

Tests live in `tests/`, grouped by behavior:

- Queue lifecycle, restart recovery, migrations, and manual-answer persistence.
- Discord role checks, anonymous display rules, card updates, and delivery retries.
- Response-sheet mapping, duplicate handling, initial baseline, and polling recovery.
- Greeting queues, TTS caching, realtime tool sequencing, microphone gating, and captions.
- Animation state mapping and input normalization.

Run a focused test while changing behavior, then `npm run check` before submitting. The smoke test starts a separate server on port 3037 with a temporary data directory, fictional arrivals, Discord disabled, and an empty OpenAI key. It must not use the real `.local-data` database.

CI performs the same checks and smoke test on Linux. For visual/audio changes, also rehearse the desktop app on macOS: drag/resize, transparent click-through, display movement, greeting audio, question playback, and captions. External integrations use mocked tests; actual service permissions and room audio need a live check by an authorized operator.

## Contribution scope

Keep changes focused and describe the user-visible behavior, implementation tradeoffs, and validation. Do not commit credentials, real member responses, queue databases, or screenshots with personal data. Use fictional fixtures.

There is no automatic publishing or deployment workflow. The CI workflow validates code only. Installer packaging and signing are future work.
