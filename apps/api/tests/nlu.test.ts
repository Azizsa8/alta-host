import { describe, it, expect } from "vitest";
import { RuleBasedIntentEngine } from "../src/modules/nlu/ruleBasedEngine.js";

const engine = new RuleBasedIntentEngine();

function typesOf(intents: { type: string }[]): string[] {
  return intents.map((i) => i.type).sort();
}

describe("RuleBasedIntentEngine — booking.extend_stay", () => {
  it("extracts extend-stay intent from 'extend my stay' with default 1 hour", async () => {
    const { intents } = await engine.extract("Can I extend my stay please?");
    expect(typesOf(intents)).toEqual(["booking.extend_stay"]);
    expect(intents[0].params.hours).toBe(1);
  });

  it("extracts a digit hour count: 'extend by 3 hours'", async () => {
    const { intents } = await engine.extract("I'd like to extend by 3 hours");
    expect(intents[0].params.hours).toBe(3);
  });

  it("extracts a digit hour count from 'late checkout' phrasing too", async () => {
    const { intents } = await engine.extract("Requesting a late checkout, 4 hours if possible");
    expect(typesOf(intents)).toContain("booking.extend_stay");
    expect(intents.find((i) => i.type === "booking.extend_stay")!.params.hours).toBe(4);
  });

  it("extracts a word-number hour count: 'two-hour late checkout'", async () => {
    const { intents } = await engine.extract("Could I get a two-hour late checkout?");
    expect(intents[0].params.hours).toBe(2);
  });

  it("extracts a word-number without the hyphen: 'one hour extension'", async () => {
    const { intents } = await engine.extract("Requesting a one hour extension please, thanks — extend stay");
    // "extend" keyword required to trigger the intent at all
    expect(typesOf(intents)).toContain("booking.extend_stay");
    expect(intents.find((i) => i.type === "booking.extend_stay")!.params.hours).toBe(1);
  });

  it("handles Arabic 'ساعتين' (two hours) with no digit present", async () => {
    const { intents } = await engine.extract("ممكن تمديد الإقامة ساعتين");
    expect(typesOf(intents)).toContain("booking.extend_stay");
    expect(intents.find((i) => i.type === "booking.extend_stay")!.params.hours).toBe(2);
  });

  it("does not fire on unrelated text mentioning 'hour' alone", async () => {
    const { intents } = await engine.extract("What time is happy hour?");
    expect(typesOf(intents)).not.toContain("booking.extend_stay");
  });
});

describe("RuleBasedIntentEngine — housekeeping.clean_room (word-order variants)", () => {
  it("matches 'clean my room' word order", async () => {
    const { intents } = await engine.extract("Please clean my room");
    expect(typesOf(intents)).toEqual(["housekeeping.clean_room"]);
  });

  it("matches 'room cleaning' word order (reversed)", async () => {
    const { intents } = await engine.extract("Requesting room cleaning for tomorrow");
    expect(typesOf(intents)).toEqual(["housekeeping.clean_room"]);
  });

  it("matches bare 'clean room' without possessive/article", async () => {
    const { intents } = await engine.extract("clean room asap");
    expect(typesOf(intents)).toEqual(["housekeeping.clean_room"]);
  });

  it("matches Arabic تنظيف phrasing", async () => {
    const { intents } = await engine.extract("تنظيف الغرفة من فضلك");
    expect(typesOf(intents)).toEqual(["housekeeping.clean_room"]);
  });
});

describe("RuleBasedIntentEngine — maintenance.report_issue", () => {
  it("matches 'not working' phrasing", async () => {
    const { intents } = await engine.extract("The AC is not working");
    expect(typesOf(intents)).toEqual(["maintenance.report_issue"]);
  });

  it("matches 'leak' phrasing", async () => {
    const { intents } = await engine.extract("There's a leak under the bathroom sink");
    expect(typesOf(intents)).toEqual(["maintenance.report_issue"]);
  });

  it("carries the raw text through as the description", async () => {
    const text = "the shower is broken";
    const { intents } = await engine.extract(text);
    expect(intents[0].params.description).toBe(text);
  });
});

describe("RuleBasedIntentEngine — reception.faq", () => {
  it("matches wifi questions", async () => {
    const { intents } = await engine.extract("What's the wifi password?");
    expect(typesOf(intents)).toEqual(["reception.faq"]);
  });

  it("matches breakfast questions", async () => {
    const { intents } = await engine.extract("What time does breakfast start?");
    expect(typesOf(intents)).toEqual(["reception.faq"]);
  });
});

describe("RuleBasedIntentEngine — guest_service.complaint", () => {
  it("matches explicit complaint keywords", async () => {
    const { intents } = await engine.extract("I'm very disappointed with the service");
    expect(typesOf(intents)).toEqual(["guest_service.complaint"]);
  });

  it("does NOT fire on angry-but-off-wordlist phrasing (tricky gap: sentiment vs. intent keyword lists diverge)", async () => {
    // "furious" / "unacceptable" drive the *sentiment* detector to
    // negative+urgent, but are absent from the complaint *intent*
    // detector's keyword list — so no guest_service.complaint intent is
    // extracted at all, even though urgency says otherwise. This is a real
    // gap in the current rule-based engine, documented here so a future
    // change to either wordlist doesn't silently regress the other.
    const envelope = await engine.extract("I'm furious, this is unacceptable!!!");
    expect(envelope.urgency).toBe("urgent");
    expect(envelope.sentiment).toBe("negative");
    expect(typesOf(envelope.intents)).not.toContain("guest_service.complaint");
  });
});

describe("RuleBasedIntentEngine — multi-intent extraction", () => {
  it("extracts multiple intents from a single message", async () => {
    const { intents } = await engine.extract("Please clean my room and what's the wifi password?");
    expect(typesOf(intents)).toEqual(["housekeeping.clean_room", "reception.faq"]);
  });
});

describe("RuleBasedIntentEngine — sentiment/urgency", () => {
  it("flags urgent on angry keywords", async () => {
    const { sentiment, urgency } = await engine.extract("This is unacceptable, I am furious!");
    expect(sentiment).toBe("negative");
    expect(urgency).toBe("urgent");
  });

  it("flags negative-but-normal on mild negative keywords", async () => {
    const { sentiment, urgency } = await engine.extract("I am a bit disappointed with the room");
    expect(sentiment).toBe("negative");
    expect(urgency).toBe("normal");
  });

  it("defaults to neutral/normal for plain text", async () => {
    const { sentiment, urgency } = await engine.extract("Thanks for the info");
    expect(sentiment).toBe("neutral");
    expect(urgency).toBe("normal");
  });

  it("returns no intents for text matching nothing", async () => {
    const { intents } = await engine.extract("Just saying hello!");
    expect(intents).toEqual([]);
  });
});
