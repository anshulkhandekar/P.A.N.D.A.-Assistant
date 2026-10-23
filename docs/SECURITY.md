# Security and data handling

## Intended environment

P.A.N.D.A. runs on a trusted presenter's laptop. The HTTP API is loopback-only and has no public-user authentication. Do not bind it to a public interface, expose it through a tunnel, or treat Discord moderator checks as protection for an internet-facing operator API.

Discord approval and playback are distinct. Pending questions are publicly visible before approval. Anonymous submissions hide the entered name in the public heading and spoken question, but retain the Discord account tag. Officer review can see the entered name.

## Credentials

Use `.env.example` as a template. Keep the populated `.env` and service-account JSON outside Git. Never put secrets in frontend environment variables or bundle them in an installer.

| Credential                  | Used for                                            |
| --------------------------- | --------------------------------------------------- |
| `DISCORD_BOT_TOKEN`         | Gateway connection and Discord messages             |
| `OPENAI_API_KEY`            | Optional speech, greetings, and private AI requests |
| Google service-account JSON | Read-only access to the shared response sheet       |

Spreadsheet, server, channel, application, and role IDs are configuration identifiers rather than authentication secrets. Still use placeholders in public examples. Prefer separately revocable credentials for different operators and only one active instance of the workshop bot.

## Data storage and transmission

- SQLite question history and pending written replies live under `PANDA_DATA_DIR` (default `.local-data/`). This database contains submitted names, Discord identifiers, question text, and answers. It is not encrypted by the application.
- Google polling reads the configured tab. Only mapped name/timestamp values are used for greetings; unrelated form answers are not assistant profile context.
- OpenAI greeting speech receives the generated welcome including the first name. OpenAI question speech receives the spoken name/anonymous label and question text. Private drafts and microphone Q&A send their respective input to the configured API.
- Native macOS question speech does not require an OpenAI request.
- Public Discord cards remain in channel history. Denying a question changes its status; it does not erase its text.

Set retention expectations with workshop organizers. Keep the laptop and local backups protected, and remove private test exports before sharing the repository.

## Before publishing

1. Check staged files for `.env`, credential JSON, databases, exports, and personal screenshots. Ignore rules do not remove files already tracked.
2. Inspect Git history as well as the current checkout. A new remote URL does not remove old commits.
3. If a credential was exposed, revoke/rotate it at its provider; deleting its file is insufficient. Remove exposed material from history before distributing that history.
4. Confirm permission to publish organization-specific artwork. No license grant for club branding is implied here.

A pattern scan is useful but cannot prove that a repository contains no secrets. Do not publish real credentials as examples or report them in public issues. For a suspected vulnerability, contact the repository owner privately using the contact information on their profile; do not include a working token or real attendee data in a public report.
