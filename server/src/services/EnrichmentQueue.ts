import {
  hasConsent,
  githubUsername,
  type MemberProfile,
} from "../../../shared/domain.js";
import { env, log } from "../config/env.js";
import { MemberCache } from "./MemberCache.js";
import { GoogleSheetsService } from "./GoogleSheetsService.js";
type Repo = {
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  fork: boolean;
  updated_at: string;
  topics: string[];
};
export class EnrichmentQueue {
  private pending: MemberProfile[] = [];
  private active = 0;
  private jobs = new Map<
    string,
    { username: string; time: number; status: string }
  >();
  lastError: string | null = null;
  constructor(
    private cache: MemberCache,
    private sheets?: GoogleSheetsService,
  ) {}
  get status() {
    const members = [...this.cache.membersById.values()];
    const consented = members.filter((m) =>
      hasConsent(m.github_enrichment_consent),
    );
    return {
      eligible: consented.filter((m) => githubUsername(m.github_url)).length,
      missingConsent: members.length - consented.length,
      invalidUrl: consented.filter((m) => !githubUsername(m.github_url)).length,
      failed: [...this.jobs.values()].filter((j) => j.status === "failed")
        .length,
      running: this.active,
      pending: this.pending.length,
      complete: [...this.jobs.values()].filter((j) => j.status === "complete")
        .length,
      lastError: this.lastError,
      enabled: env.ENABLE_GITHUB_ENRICHMENT,
    };
  }
  async hydrate() {
    if (!this.sheets) return;
    try {
      for (const row of await this.sheets.read(env.PRIVATE_ENRICHMENT_SHEET)) {
        const m = this.cache.membersById.get(row.member_id);
        if (
          m &&
          hasConsent(m.github_enrichment_consent) &&
          githubUsername(m.github_url) === row.github_username &&
          row.status === "complete" &&
          Date.now() - Date.parse(row.enriched_at) < 86400000
        ) {
          this.cache.github.set(
            row.member_id,
            JSON.parse(row.github_summary_json),
          );
          this.jobs.set(row.member_id, {
            username: row.github_username,
            time: Date.parse(row.enriched_at),
            status: "complete",
          });
        }
      }
    } catch {
      this.lastError = "Enrichment cache could not be loaded";
    }
  }
  enqueue(m: MemberProfile) {
    if (
      !env.ENABLE_GITHUB_ENRICHMENT ||
      !hasConsent(m.github_enrichment_consent)
    )
      return;
    const username = githubUsername(m.github_url);
    if (!username) return;
    const job = this.jobs.get(m.member_id);
    if (
      job &&
      job.username === username &&
      (job.status === "pending" ||
        job.status === "running" ||
        Date.now() - job.time < (job.status === "failed" ? 300000 : 86400000))
    )
      return;
    this.jobs.set(m.member_id, {
      username,
      time: Date.now(),
      status: "pending",
    });
    this.pending.push({ ...m });
    this.drain();
  }
  private drain() {
    while (this.active < 2 && this.pending.length) {
      const m = this.pending.shift()!;
      this.active++;
      void this.run(m).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
  private async get(path: string) {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error(`GitHub HTTP ${r.status}`);
    return r.json();
  }
  private async run(m: MemberProfile) {
    const username = githubUsername(m.github_url)!;
    this.jobs.set(m.member_id, {
      username,
      time: Date.now(),
      status: "running",
    });
    log("GITHUB_ENRICHMENT_STARTED", { memberId: m.member_id });
    try {
      const [profile, repos] = (await Promise.all([
        this.get(`/users/${username}`),
        this.get(`/users/${username}/repos?per_page=100&sort=updated`),
      ])) as [Record<string, unknown>, Repo[]];
      const languages = new Map<string, number>();
      for (const r of repos)
        if (!r.fork && r.language)
          languages.set(r.language, (languages.get(r.language) || 0) + 1);
      const score = (r: Repo) =>
        Math.log2(1 + r.stargazers_count) * 4 +
        (r.fork ? 0 : 5) +
        (r.description ? 2 : 0) +
        Math.max(
          0,
          2 - (Date.now() - Date.parse(r.updated_at)) / 86400000 / 180,
        );
      const summary = {
        username,
        bio: String(profile.bio || "").slice(0, 300),
        totalPublicRepos: profile.public_repos,
        topLanguages: [...languages]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([l]) => l),
        notableRepos: repos
          .sort((a, b) => score(b) - score(a))
          .slice(0, 4)
          .map((r) => ({
            name: r.name,
            description: r.description?.slice(0, 200),
            language: r.language,
            stars: r.stargazers_count,
            forks: r.forks_count,
            topics: r.topics?.slice(0, 5),
            updatedAt: r.updated_at,
          })),
        inferredProjectThemes: [
          ...new Set(repos.flatMap((r) => r.topics || [])),
        ].slice(0, 6),
      };
      const latest = this.cache.membersById.get(m.member_id);
      if (
        !latest ||
        !hasConsent(latest.github_enrichment_consent) ||
        githubUsername(latest.github_url) !== username
      ) {
        this.jobs.delete(m.member_id);
        return;
      }
      this.cache.github.set(m.member_id, summary);
      if (this.sheets)
        await this.sheets.saveEnrichment({
          member_id: m.member_id,
          github_username: username,
          github_profile_json: JSON.stringify({
            bio: profile.bio,
            public_repos: profile.public_repos,
          }),
          github_summary_json: JSON.stringify(summary),
          enriched_at: new Date().toISOString(),
          status: "complete",
          error_message: "",
        });
      this.jobs.set(m.member_id, {
        username,
        time: Date.now(),
        status: "complete",
      });
      this.lastError = null;
      log("GITHUB_ENRICHMENT_COMPLETE", { memberId: m.member_id });
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "Enrichment failed";
      this.jobs.set(m.member_id, {
        username,
        time: Date.now(),
        status: "failed",
      });
      log("GITHUB_ENRICHMENT_FAILED", { memberId: m.member_id });
    }
  }
}
