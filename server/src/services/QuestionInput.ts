// A deliberately small, deterministic filter; officer review remains necessary.
export function cleanQuestionInput(name: string, text: string) {
  const clean = (value: string) =>
    value
      .normalize("NFKC")
      .replace(
        /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
  name = clean(name);
  text = clean(text);
  if (!name || name.length > 60 || !text || text.length > 600)
    throw Error(
      "Enter a name (1–60 characters) and question (1–600 characters).",
    );
  if (!/^[\p{L}\p{M} .’'\-]+$/u.test(name) || !/\p{L}/u.test(name))
    throw Error(
      "Please use a name with letters, spaces, apostrophes, or hyphens.",
    );
  const normalized = (name + " " + text)
    .toLowerCase()
    .replace(
      /[013@$!]/g,
      (c) => ({ "0": "o", "1": "i", "3": "e", "@": "a", $: "s", "!": "i" })[c]!,
    );
  if (/\b(?:fuck\w*|shit\w*|bitch\w*|asshole\w*|cunt\w*)\b/i.test(normalized))
    throw Error("Please rephrase your name or question without profanity.");
  return { name, text };
}
