import "dotenv/config";
import { z } from "zod";
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true"));
export const env = z
  .object({
    PORT: z.coerce.number().default(3001),
    CLIENT_URL: z.string().default("http://localhost:5173"),
    DEMO_MODE: bool(true),
    OPENAI_API_KEY: z.string().default(""),
    REALTIME_MODEL: z.string().default("gpt-realtime-2.1-mini"),
    REALTIME_VOICE: z.string().default("marin"),
    TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
    TTS_VOICE: z.string().default("coral"),
    WEB_SEARCH_MODEL: z.string().default("gpt-5.6-luna"),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default(""),
    GOOGLE_SERVICE_ACCOUNT_FILE: z.string().default(""),
    PRIVATE_SPREADSHEET_ID: z.string().default(""),
    PRIVATE_MEMBERS_SHEET: z.string().default("Members"),
    PRIVATE_SESSION_SHEET: z.string().default("SessionSignIns"),
    PRIVATE_ENRICHMENT_SHEET: z.string().default("EnrichmentCache"),
    SESSION_ID: z.string().default("2026-09-22-backprop"),
    SESSION_NAME: z.string().default("Backpropagation & Neural Networks"),
    SHEETS_POLL_INTERVAL_MS: z.coerce.number().min(1000).default(2000),
    GITHUB_TOKEN: z.string().default(""),
    ENABLE_GITHUB_ENRICHMENT: bool(true),
    ENABLE_WEB_SEARCH: bool(true),
    ENABLE_AUTO_GREET: bool(true),
  })
  .parse(process.env);
export const log = (event: string, details: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ time: new Date().toISOString(), event, ...details }),
  );
