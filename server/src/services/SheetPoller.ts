import { env, log } from "../config/env.js";
import {
  unseenEvents,
  type MemberProfile,
  type SignIn,
  type Arrival,
} from "../../../shared/domain.js";
import { MemberCache } from "./MemberCache.js";
import { GoogleSheetsService } from "./GoogleSheetsService.js";
export class SheetPoller {
  seen = new Set<string>();
  lastSync: string | null = null;
  lastError: string | null = null;
  private failures = 0;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private initialized = false;
  constructor(
    private sheets: GoogleSheetsService,
    private cache: MemberCache,
    private onArrival: (a: Arrival) => void,
    private enrich: (m: MemberProfile) => void,
  ) {}
  start() {
    const tick = async () => {
      await this.refresh();
      this.timer = setTimeout(
        tick,
        Math.min(60000, env.SHEETS_POLL_INTERVAL_MS * 2 ** this.failures),
      );
    };
    void tick();
  }
  stop() {
    clearTimeout(this.timer);
  }
  refresh() {
    if (this.running) return this.running;
    this.running = this.sync().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async sync() {
    try {
      const [members, events] = await this.sheets.snapshot();
      for (const m of members) {
        if (!m.member_id || !m.display_name)
          throw Error("Members row is missing identity fields");
        this.cache.upsert(m as MemberProfile);
      }
      const fresh = unseenEvents(
        events as unknown as SignIn[],
        this.seen,
        env.SESSION_ID,
      );
      for (const e of fresh) {
        const arrival = this.cache.arrive(e);
        this.seen.add(e.event_id);
        if (this.initialized) {
          log("SIGN_IN_DETECTED", {
            eventId: e.event_id,
            pandaCode: arrival.pandaCode,
          });
          this.onArrival(arrival);
        }
      }
      this.initialized = true;
      for (const m of this.cache.membersById.values()) this.enrich(m);
      this.lastSync = new Date().toISOString();
      this.lastError = null;
      this.failures = 0;
    } catch (error) {
      this.failures = Math.min(this.failures + 1, 5);
      this.lastError =
        error instanceof Error ? error.message : "Sheets sync failed";
      log("SHEETS_SYNC_ERROR", { retry: this.failures });
    }
  }
}
