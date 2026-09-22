import { GoogleAuth } from "google-auth-library";
import { env } from "../config/env.js";
export const enrichmentHeaders = [
  "member_id",
  "github_username",
  "github_profile_json",
  "github_summary_json",
  "enriched_at",
  "status",
  "error_message",
];
export class GoogleSheetsService {
  private auth: GoogleAuth;
  constructor() {
    this.auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      ...(env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? { credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) }
        : { keyFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || undefined }),
    });
  }
  private range(sheet: string) {
    return `'${sheet.replace(/'/g, "''")}'`;
  }
  private async request(method: string, route: string, data?: unknown) {
    const client = await this.auth.getClient();
    return (
      await client.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${env.PRIVATE_SPREADSHEET_ID}${route}`,
        method: method as "GET",
        data,
        timeout: 12000,
      })
    ).data as { values?: string[][]; valueRanges?: { values?: string[][] }[] };
  }
  private parse(
    sheet: string,
    values: string[][] = [],
  ): Record<string, string>[] {
    const [headers, ...rows] = values;
    if (!headers) throw Error("Missing headers: " + sheet);
    if (new Set(headers).size !== headers.length)
      throw Error("Duplicate headers: " + sheet);
    return rows
      .filter((r) => r.some(Boolean))
      .map((row) =>
        Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? "")])),
      );
  }
  async read(sheet: string) {
    const result = await this.request(
      "GET",
      `/values/${encodeURIComponent(this.range(sheet))}`,
    );
    return this.parse(sheet, result.values);
  }
  async snapshot() {
    const names = [env.PRIVATE_MEMBERS_SHEET, env.PRIVATE_SESSION_SHEET];
    const query = names
      .map((name) => "ranges=" + encodeURIComponent(this.range(name)))
      .join("&");
    const result = await this.request("GET", "/values:batchGet?" + query);
    return names.map((name, i) =>
      this.parse(name, result.valueRanges?.[i]?.values),
    );
  }
  async saveEnrichment(row: Record<string, string>) {
    await this.request(
      "POST",
      `/values/${encodeURIComponent(this.range(env.PRIVATE_ENRICHMENT_SHEET) + "!A:G")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [enrichmentHeaders.map((h) => row[h] || "")] },
    );
  }
}
