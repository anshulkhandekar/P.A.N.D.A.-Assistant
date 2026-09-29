import { createHash } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { env } from "../config/env.js";
import type { Arrival } from "../../../shared/domain.js";

const normalizeHeader = (value: string) => value.trim().replace(/\s+/g, " ");

// Only the two explicitly mapped columns leave this adapter. Other form answers
// (including collected email addresses) are not profiles or model context.
export function parseSignIns(
  values: string[][],
  nameHeader: string,
  timestampHeader: string,
): Arrival[] {
  const headers = (values[0] || []).map(normalizeHeader);
  const column = (label: string) => {
    const matches = headers.flatMap((h, i) =>
      h === normalizeHeader(label) ? [i] : [],
    );
    if (matches.length !== 1)
      throw Error(
        `${matches.length ? "Duplicate" : "Missing"} response header: ${label}. Check the greeting column settings in .env.`,
      );
    return matches[0];
  };
  const nameColumn = column(nameHeader);
  const timestampColumn = column(timestampHeader);
  if (nameColumn === timestampColumn)
    throw Error("Name and timestamp must use different columns.");
  const occurrences = new Map<string, number>();
  return values.slice(1).flatMap((row) => {
    const name = String(row[nameColumn] || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    const timestamp = String(row[timestampColumn] || "").trim();
    if (!name || !timestamp) return [];
    // Stable across row sorting and unrelated-answer edits. An occurrence suffix
    // keeps even identical simultaneous submissions distinct, without using email.
    const key = createHash("sha256")
      .update(JSON.stringify([timestamp, name]))
      .digest("hex");
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    return [
      {
        eventId: `${key}:${occurrence}`,
        displayName: name.slice(0, 80),
        firstName: name.split(" ")[0].slice(0, 60),
      },
    ];
  });
}

export class GoogleSheetsService {
  private auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    ...(env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? { credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) }
      : { keyFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || undefined }),
  });
  async snapshot(): Promise<Arrival[]> {
    if (!env.GREETINGS_SPREADSHEET_ID)
      throw Error(
        "Set GREETINGS_SPREADSHEET_ID to the spreadsheet linked to your Form.",
      );
    const client = await this.auth.getClient();
    const range = `'${env.GREETINGS_SHEET_NAME.replace(/'/g, "''")}'`;
    const response = await client.request<{ values?: string[][] }>({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GREETINGS_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}`,
      method: "GET",
      timeout: 12000,
    });
    return parseSignIns(
      response.data.values || [],
      env.GREETINGS_NAME_HEADER,
      env.GREETINGS_TIMESTAMP_HEADER,
    );
  }
}
