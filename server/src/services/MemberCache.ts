import {
  normalizePandaCode,
  normalizeEmail,
  type MemberProfile,
  type SignIn,
  type Arrival,
  hasConsent,
} from "../../../shared/domain.js";
export class MemberCache {
  membersById = new Map<string, MemberProfile>();
  membersByEmail = new Map<string, MemberProfile>();
  membersByPandaCode = new Map<string, string>();
  github = new Map<string, Record<string, unknown>>();
  upsert(m: MemberProfile) {
    const old = this.membersById.get(m.member_id);
    if (old?.email_normalized) this.membersByEmail.delete(old.email_normalized);
    this.membersById.set(m.member_id, m);
    if (m.email_normalized)
      this.membersByEmail.set(normalizeEmail(m.email_normalized), m);
    if (
      !hasConsent(m.github_enrichment_consent) ||
      (old && old.github_url !== m.github_url)
    )
      this.github.delete(m.member_id);
  }
  arrive(e: SignIn): Arrival {
    const code = normalizePandaCode(e.panda_code);
    if (!code) throw Error("Invalid Panda code in SessionSignIns");
    const existing = this.membersByPandaCode.get(code);
    if (existing && existing !== e.member_id)
      throw Error("Conflicting Panda code: " + code);
    if (!this.membersById.has(e.member_id))
      throw Error("Sign-in has no member");
    this.membersByPandaCode.set(code, e.member_id);
    const m = this.membersById.get(e.member_id)!;
    return {
      eventId: e.event_id,
      pandaCode: code,
      displayCode: `Panda ${code.slice(1)}`,
      displayName: m.display_name,
      firstName: m.first_name || m.display_name.split(" ")[0],
    };
  }
  getMemberContext(input: string) {
    const code = normalizePandaCode(input);
    const id = code && this.membersByPandaCode.get(code);
    const m = id && this.membersById.get(id);
    if (!m) return null;
    return {
      name: m.first_name || m.display_name.split(" ")[0],
      classification: m.classification,
      major: m.major,
      careerInterests: [m.career_interest, m.secondary_interest].filter(
        Boolean,
      ),
      currentGoal: m.current_goal,
      experienceLevel: m.experience_level,
      workStyle: m.work_style,
      // Older survey selections are interests, not claims about present plans or skill.
      historicalInterests: {
        learningGoals: m.learning_goals?.slice(0, 400),
        dreamCompany: m.dream_company?.slice(0, 160),
        projectExperience: m.past_project_experience?.slice(0, 300),
        requestedTopics: m.requested_topics?.slice(0, 400),
      },
      interests: [m.favorite_activity].filter(Boolean),
      github: hasConsent(m.github_enrichment_consent)
        ? this.github.get(m.member_id)
        : undefined,
    };
  }
}
