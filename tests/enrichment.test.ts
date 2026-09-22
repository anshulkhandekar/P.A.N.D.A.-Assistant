import { expect, it } from "vitest";
import { MemberCache } from "../server/src/services/MemberCache";
import { EnrichmentQueue } from "../server/src/services/EnrichmentQueue";
import type { MemberProfile } from "../shared/domain";

it("distinguishes missing consent, missing URLs, and eligible profiles without fetching", () => {
  const cache = new MemberCache();
  for (const [id, consent, url] of [
    ["a", "true", ""],
    ["b", "false", "https://github.com/octocat"],
    ["c", "true", "https://github.com/octocat"],
    ["d", "true", "https://github.com/octocat/Hello-World"],
  ])
    cache.upsert({
      member_id: id,
      github_enrichment_consent: consent,
      github_url: url,
    } as MemberProfile);
  expect(new EnrichmentQueue(cache).status).toMatchObject({
    eligible: 1,
    missingConsent: 1,
    invalidUrl: 2,
    failed: 0,
  });
});
