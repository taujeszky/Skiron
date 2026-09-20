import { describe, expect, it } from "vitest";
import { newCaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import type { CaseFrame } from "$lib/engine/types";
import {
  monogramSvg,
  monogramUrl,
  PALETTE,
  personColor,
  personGlyph,
  personHex,
  personInitials,
  VICTIM_COLOR,
} from "./look";

function frameFor(): CaseFrame {
  const out = generate(newCaseId("easy", "look1"));
  if (!out.case) throw new Error("the fixture case did not generate");
  return out.case.frame;
}

const FRAME = frameFor();

describe("the palette", () => {
  it("has a hex value for every CSS variable the map uses", () => {
    // `personColor` hands out `var(--p0)`..`var(--p7)`; the SVG cannot resolve
    // a CSS variable, so these two lists have to stay the same length.
    const used = new Set(
      Array.from({ length: 8 }, (_, p) =>
        personColor({ ...FRAME, victim: 99 } as CaseFrame, p),
      ),
    );
    expect(used.size).toBe(PALETTE.length);
  });

  it("gives the victim their own colour, in both forms", () => {
    expect(personColor(FRAME, FRAME.victim)).toBe("var(--victim)");
    expect(personHex(FRAME, FRAME.victim)).toBe(VICTIM_COLOR);
  });

  it("never runs off the end of the palette", () => {
    expect(personHex(FRAME, 100)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("the initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(personInitials(FRAME, 0, "Gregory Bell")).toBe("GB");
  });

  it("ignores an honorific, which carries nothing", () => {
    // Otherwise half a Victorian cast reads "MR".
    expect(personInitials(FRAME, 0, "Mrs Pellworth")).toBe("P");
    expect(personInitials(FRAME, 0, "Dr. Vera Meyer")).toBe("VM");
  });

  it("keeps the honorific when it is the whole name", () => {
    expect(personInitials(FRAME, 0, "Sir")).toBe("S");
  });

  it("falls back to the token's letter when there is no name at all", () => {
    // A case played in the engine's own words has no names, which is how
    // everything looked until wave 5.
    expect(personInitials(FRAME, 0)).toBe(personGlyph(FRAME, 0));
    expect(personInitials(FRAME, 0, "   ")).toBe("A");
    expect(personInitials(FRAME, FRAME.victim)).toBe("†");
  });

  it("handles a name outside Latin-1", () => {
    expect(personInitials(FRAME, 0, "Örjan Lindqvist")).toBe("ÖL");
  });
});

describe("the monogram", () => {
  it("is deterministic — the plan's own test", () => {
    const once = monogramSvg(FRAME, 2, "Vera Lindqvist");
    const twice = monogramSvg(FRAME, 2, "Vera Lindqvist");
    expect(twice).toBe(once);
    // Byte for byte, not merely equivalent: the same person is the same
    // picture on the briefing, in the cast strip and beside their replies.
    expect(monogramUrl(FRAME, 2, "Vera Lindqvist")).toBe(monogramUrl(FRAME, 2, "Vera Lindqvist"));
  });

  it("differs by person, so two suspects are never the same coin", () => {
    expect(monogramSvg(FRAME, 0, "Anna Bell")).not.toBe(monogramSvg(FRAME, 1, "Anna Bell"));
  });

  it("carries the person's colour and initials", () => {
    const svg = monogramSvg(FRAME, 1, "Vera Lindqvist");
    expect(svg).toContain(personHex(FRAME, 1));
    expect(svg).toContain(">VL<");
  });

  it("escapes a name that would otherwise break the markup", () => {
    const svg = monogramSvg(FRAME, 0, '<script>x</script> & "co"');
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&amp;");
  });

  it("scales the box and the lettering together", () => {
    expect(monogramSvg(FRAME, 0, "Anna Bell", 22)).toContain('width="22"');
    expect(monogramSvg(FRAME, 0, "Anna Bell", 256)).toContain('width="256"');
  });

  it("makes a URL an <img> will take", () => {
    const url = monogramUrl(FRAME, 0, "Anna Bell");
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml,".length))).toBe(
      monogramSvg(FRAME, 0, "Anna Bell"),
    );
  });
});
