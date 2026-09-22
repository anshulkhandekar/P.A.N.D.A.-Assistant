export type Mode = "arrival" | "qa";
export type PandaState =
  | "idle"
  | "typing"
  | "new_arrival"
  | "look_up"
  | "listening"
  | "thinking"
  | "tool_using"
  | "speaking"
  | "return_to_keyboard";
export interface MemberProfile {
  member_id: string;
  email_normalized: string;
  display_name: string;
  first_name: string;
  github_enrichment_consent: string;
  github_url: string;
  [field: string]: string;
}
export interface SignIn {
  event_id: string;
  session_id: string;
  session_sequence: string;
  panda_code: string;
  member_id: string;
  display_name: string;
  submitted_at: string;
  processed_at: string;
  greeting_status: string;
}
export interface Arrival {
  eventId: string;
  pandaCode: string;
  displayCode: string;
  displayName: string;
  firstName: string;
}
export interface Controls {
  greetingVoice?: string;
  responseVoice?: string;
  microphoneId?: string;
  mode: Mode;
  muted: boolean;
  micPaused: boolean;
  autoGreet: boolean;
  forcedState: PandaState | null;
  activeCode: string | null;
}
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const normalizeName = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
export function mergeProfile(
  old: Partial<MemberProfile>,
  incoming: Partial<MemberProfile>,
): MemberProfile {
  return {
    ...old,
    ...Object.fromEntries(
      Object.entries(incoming).filter(
        ([, v]) => v !== undefined && v.trim() !== "",
      ),
    ),
  } as MemberProfile;
}
export function findExistingMember(
  members: MemberProfile[],
  email: string,
  name: string,
): MemberProfile | undefined {
  const key = normalizeEmail(email);
  if (key) return members.find((m) => m.email_normalized === key);
  const matches = members.filter(
    (m) => normalizeName(m.display_name) === normalizeName(name),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
const small = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const tens = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
export function normalizePandaCode(input: string): string | null {
  if (/-\s*\d/.test(input)) return null;
  let s = input
    .trim()
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/^(?:panda|p)\s*(?:number\s*)?/, "")
    .trim();
  let n = /^\d{1,3}$/.test(s) ? Number(s) : 0;
  if (!n)
    for (let i = 1; i <= 100; i++) {
      const word =
        i === 100
          ? "one hundred"
          : i < 20
            ? small[i]
            : tens[Math.floor(i / 10)] + (i % 10 ? " " + small[i % 10] : "");
      if (s === word) n = i;
    }
  return Number.isInteger(n) && n >= 1 && n <= 100 ? `P${n}` : null;
}
export function allocateSequence(next: number, used: number[]): number {
  if (!Number.isInteger(next) || next < 1)
    throw Error("Invalid session sequence");
  const result =
    Math.max(next, 0, ...used) +
    (used.includes(Math.max(next, 0, ...used)) ? 1 : 0);
  if (result > 100) throw Error("Session is limited to 100 codes");
  return result;
}
export function unseenEvents(
  rows: SignIn[],
  seen: Set<string>,
  sessionId: string,
): SignIn[] {
  const unique = new Map<string, SignIn>();
  for (const row of rows)
    if (row.session_id === sessionId && !seen.has(row.event_id) && row.event_id)
      unique.set(row.event_id, row);
  return [...unique.values()].sort(
    (a, b) => Number(a.session_sequence) - Number(b.session_sequence),
  );
}
export const hasConsent = (value: string) =>
  /^(true|yes|yes, i consent|i consent)$/i.test(value.trim());
export function githubUsername(value: string): string | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      url.protocol !== "https:" ||
      !["github.com", "www.github.com"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length === 1 &&
      /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(parts[0])
      ? parts[0]
      : null;
  } catch {
    return null;
  }
}
export class GreetingQueue {
  private items: Arrival[] = [];
  private seen = new Set<string>();
  enqueue(item: Arrival) {
    if (this.seen.has(item.eventId)) return false;
    this.seen.add(item.eventId);
    this.items.push(item);
    return true;
  }
  shift() {
    return this.items.shift();
  }
  clear() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  snapshot() {
    return [...this.items];
  }
}
export const greetingTemplates = [
  "Hey {name}, welcome in.",
  "What’s up, {name}? Glad you made it.",
  "Welcome, {name}.",
  "Hey {name}. You’re officially checked in.",
  "Good to see you, {name}.",
  "{name}! Welcome to ADSC.",
  "Hey {name}, grab a seat.",
  "Glad you’re here, {name}.",
  "Welcome aboard, {name}.",
  "Hey {name}, let’s build something.",
  "{name}, you made it. Welcome!",
  "Welcome in, {name}. Make yourself at home.",
  "Hey {name}. Ready when you are.",
  "There’s {name}. Welcome in.",
  "{name}, welcome to the club.",
];
export function greetingFor(a: Arrival) {
  let hash = 0;
  for (const c of a.eventId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return greetingTemplates[hash % greetingTemplates.length].replace(
    "{name}",
    a.firstName.slice(0, 60),
  );
}
