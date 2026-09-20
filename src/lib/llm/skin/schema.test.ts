import { describe, expect, it } from "vitest";
import { frameOf, gridPlan } from "../../engine/testkit";
import { shapeOf, validateWriterOutput, writerSchema, type SkinShape } from "./schema";

const FRAME = frameOf({ plan: gridPlan(3, 2), suspects: 3, slots: 4, murderRoom: 4 });
const SHAPE: SkinShape = shapeOf(FRAME);
const IDS = ["c1", "c2", "c3"];

/** A writer's answer that should pass, so each test can spoil one thing. */
function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "A Title",
    place: "somewhere",
    era: "1923",
    styleGuide: "cold light",
    rooms: Array.from({ length: SHAPE.rooms }, (_, r) => ({
      name: `room ${r}`,
      code: `R${r}`,
      description: "a room",
    })),
    slots: Array.from({ length: SHAPE.slots }, (_, t) => `hour ${t}`),
    people: Array.from({ length: SHAPE.people }, (_, p) => ({
      name: `Person ${p}`,
      role: "somebody",
      bio: "a bio",
      voice: "flat",
      motive: p === SHAPE.victim ? "" : "a debt",
      portrait: "a face",
    })),
    prose: IDS.map((id) => ({ id, text: `prose for ${id}` })),
    silence: Array.from({ length: SHAPE.people }, () => "nothing to add"),
    briefing: "a briefing",
    scene: "a scene",
    ...overrides,
  };
}

describe("the writer's schema", () => {
  const schema = writerSchema(SHAPE, IDS);

  it("pins the arrays whose length is a contract with engine ids", () => {
    // "One per room, in order" is the only thing connecting an array position
    // to a room id. Six names for seven rooms silently renumbers the house.
    for (const [field, count] of [
      ["rooms", SHAPE.rooms],
      ["slots", SHAPE.slots],
      ["people", SHAPE.people],
      ["silence", SHAPE.people],
    ] as const) {
      expect([field, schema.properties?.[field].minItems]).toEqual([field, count]);
      expect([field, schema.properties?.[field].maxItems]).toEqual([field, count]);
    }
  });

  it("does NOT bound the prose array, which a live 400 taught it", () => {
    /*
     * Measured on gemini-3.7-flash, 2026-09-20: with `minItems`/`maxItems`
     * this request is refused outright once the case passes about fifty
     * cards — accepted at 50, refused at 54 — because a bounded array
     * multiplies its item schema and this item carries an `enum` of every
     * clue id. One Expert case in six is over that line.
     *
     * Asserted so that somebody making the schema tidier puts the bounds
     * back and finds out here rather than in a paid batch, or worse, in a
     * player's browser on the one case that happens to be large.
     */
    expect(schema.properties?.prose.minItems).toBeUndefined();
    expect(schema.properties?.prose.maxItems).toBeUndefined();
    // The ids are still pinned, which is what stops invented entries.
    expect(schema.properties?.prose.items?.properties?.id.enum).toEqual(IDS);
  });

  it("forbids invented fields everywhere", () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.rooms.items?.additionalProperties).toBe(false);
    expect(schema.properties?.people.items?.additionalProperties).toBe(false);
  });
});

describe("validating the writer's answer", () => {
  const check = (overrides: Record<string, unknown> = {}) =>
    validateWriterOutput(answer(overrides), SHAPE, IDS);

  it("accepts a good one", () => {
    const { output, problems } = check();
    expect(problems).toEqual([]);
    expect(output).not.toBeNull();
    expect(output!.rooms).toHaveLength(SHAPE.rooms);
    expect(output!.prose).toHaveLength(IDS.length);
  });

  it("is what really enforces prose coverage, now the schema does not", () => {
    // This is the guard the unbounded array leans on, so it has to name the
    // missing ids — a retry told "some prose is missing" can do nothing.
    const { output, problems } = check({ prose: [{ id: "c1", text: "only one" }] });
    expect(output).toBeNull();
    const text = problems.join(" ");
    expect(text).toContain("prose is missing");
    expect(text).toContain("c2");
    expect(text).toContain("c3");
  });

  it("refuses prose for a clue that is not in this case", () => {
    const { output, problems } = check({
      prose: [...IDS.map((id) => ({ id, text: "fine" })), { id: "c999", text: "invented" }],
    });
    expect(output).toBeNull();
    expect(problems.join(" ")).toContain("c999");
  });

  it("refuses two entries for one clue", () => {
    const { output, problems } = check({
      prose: [...IDS.map((id) => ({ id, text: "fine" })), { id: "c1", text: "again" }],
    });
    expect(output).toBeNull();
    expect(problems.join(" ")).toContain("two entries");
  });

  it("refuses a suspect with no motive, which is a leak of its own", () => {
    const people = answer().people as Record<string, unknown>[];
    const { output, problems } = check({
      people: people.map((p, i) => (i === 0 ? { ...p, motive: "" } : p)),
    });
    expect(output).toBeNull();
    expect(problems.join(" ")).toContain("people[0].motive is missing");
  });

  it("lets the victim have no motive", () => {
    expect(check().problems).toEqual([]);
  });

  it("refuses the wrong number of rooms, hours or people", () => {
    expect(check({ rooms: [] }).output).toBeNull();
    expect(check({ slots: ["one"] }).output).toBeNull();
    expect(check({ people: [] }).output).toBeNull();
  });

  it("refuses room codes that collide, because they head the grid columns", () => {
    const rooms = (answer().rooms as Record<string, unknown>[]).map((r) => ({ ...r, code: "XX" }));
    expect(check({ rooms }).problems.join(" ")).toContain("every room code must be different");
  });

  it("refuses a room code that is not two or three characters", () => {
    const rooms = answer().rooms as Record<string, unknown>[];
    const bad = rooms.map((r, i) => (i === 0 ? { ...r, code: "TOOLONG" } : r));
    expect(check({ rooms: bad }).problems.join(" ")).toContain("two or three");
  });

  it("refuses duplicate names, for people, rooms and hours alike", () => {
    const people = (answer().people as Record<string, unknown>[]).map((p) => ({ ...p, name: "Same" }));
    expect(check({ people }).problems.join(" ")).toContain("named differently");
    expect(check({ slots: Array.from({ length: SHAPE.slots }, () => "nine") }).problems.join(" ")).toContain(
      "named differently",
    );
  });

  it("refuses something that is not an object at all", () => {
    for (const value of [null, 3, "skin", []]) {
      expect(validateWriterOutput(value, SHAPE, IDS).output).toBeNull();
    }
  });

  it("collects every complaint rather than stopping at the first", () => {
    // They are handed back to the model verbatim, so one round trip should
    // fix everything that is wrong, not the first thing.
    const { problems } = check({ rooms: [], slots: [], title: "" });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});
