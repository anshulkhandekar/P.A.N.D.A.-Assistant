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
export interface Arrival {
  eventId: string;
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
  "Hey {name}, welcome in!",
  "Good evening, {name}! Glad you’re here.",
  "Welcome, {name}! Let’s talk quant.",
  "Hey {name}, ready for some quant knowledge?",
  "Good to see you, {name}!",
  "{name}! Welcome to ADSC.",
  "Hey {name}, grab a seat and join us!",
  "Welcome, {name}! We’re glad you made it.",
  "{name}, welcome aboard. Bring on the numbers!",
  "Hey {name}, let’s turn data into ideas!",
  "{name}, you made it! Let’s get curious.",
  "Welcome in, {name}! Big ideas, good company.",
  "Hey {name}, ready for some quant thoughts?",
  "There’s {name}! Good company, interesting equations.",
  "{name}, welcome to the club! Let’s make data make sense.",
];
export function greetingFor(a: Arrival) {
  let hash = 0;
  for (const c of a.eventId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return greetingTemplates[hash % greetingTemplates.length].replace(
    "{name}",
    a.firstName.slice(0, 60),
  );
}
