import { describe, it, expect } from "vitest";
import { detectLang, splitByLang } from "../src/lib/lang.js";

// Verbatim self-test cases for the language tagger.
describe("detectLang", () => {
  const cases: [string, string][] = [
    ["kalimera, tha se paro tilefono meta, eimai edo kai perimeno", "gr-latn"],
    ["ela re file pame gia kafe tora?", "gr-latn"],
    ["Καλημέρα, θα σε πάρω τηλέφωνο", "el"],
    ["can you check the webhook retries and add a test", "en"],
    ["re-run the na tests before the release", "en"],
    ["1234 !!", "other"],
  ];
  for (const [text, want] of cases) {
    it(`${text.slice(0, 32)} → ${want}`, () => {
      expect(detectLang(text)).toBe(want);
    });
  }
});

describe("splitByLang", () => {
  it("mixed mail splits el then en", () => {
    const mixed =
      "Θα ήθελα την γνώμη σας για ένα θέμα που με απασχολεί εδώ και " +
      "καιρό σχετικά με την παραγγελία και την εξέλιξή της.\n\n" +
      "Separately, could you confirm the invoice number and the " +
      "delivery window for the second batch of the order?";
    expect(splitByLang(mixed).map(([l]) => l)).toEqual(["el", "en"]);
  });

  it("a short greeting does not split an English mail", () => {
    const greeting =
      "Καλημέρα,\n\n" +
      "quick update, the migration finished and the checks are " +
      "green so I am closing the ticket and moving to the next " +
      "item on the list for this week.";
    const got = splitByLang(greeting);
    expect(got.length).toBe(1);
    expect(got[0]![0]).toBe("en");
  });
});
