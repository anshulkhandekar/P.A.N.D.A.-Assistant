import { expect, it } from "vitest";
import { cleanQuestionInput } from "../server/src/services/QuestionInput";
it("normalizes input without stripping international names or technical questions", () => {
  expect(
    cleanQuestionInput(" José O’Neil ", "\u202eWhat is x < y?\n  Why?"),
  ).toEqual({ name: "José O’Neil", text: "What is x < y? Why?" });
});
it("rejects impersonating mentions, URLs in names and common profanity", () => {
  for (const name of ["@everyone", "<@123>", "https://example.com", "123"])
    expect(() => cleanQuestionInput(name, "Why?")).toThrow();
  expect(() => cleanQuestionInput("Anshul", "What the sh1t?")).toThrow(
    "profanity",
  );
  expect(() =>
    cleanQuestionInput("Anshul", "How does classification work?"),
  ).not.toThrow();
});
