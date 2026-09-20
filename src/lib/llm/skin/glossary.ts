/**
 * A skin, read as a `Glossary`.
 *
 * This is the whole of task 7. The plan says "with a skin present,
 * `explain.ts` sentences use the skin's names", which sounds like a change to
 * `explain.ts` and is not: that file has taken a glossary on every path since
 * wave 2 and only defaults politely when nobody passes one. What was missing
 * was somebody to pass one, and a skin to build it from.
 *
 * Every lookup falls back to the engine's placeholder name rather than
 * throwing or returning `undefined`. A skin can arrive short — an older
 * stored one, a pack written before a room was added, a model that returned
 * six names for seven rooms and slipped past validation — and the failure
 * that matters is a sentence reading "was in undefined at nine", not a
 * missing name. A placeholder in one cell is visibly wrong and harmless;
 * `undefined` in a hint is neither.
 */

import { defaultGlossary } from "../../engine/solver/explain";
import type { CaseFrame, Glossary, PersonId, RoomId, SlotIndex } from "../../engine/types";
import type { CaseSkin } from "./schema";

export function skinGlossary(skin: CaseSkin, frame: CaseFrame): Glossary {
  const plain = defaultGlossary(frame);
  const pick = (value: string | undefined, fallback: string): string => {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? fallback : text;
  };

  return {
    personName: (p: PersonId) => pick(skin.people[p]?.name, plain.personName(p)),
    roomName: (r: RoomId) => pick(skin.rooms[r]?.name, plain.roomName(r)),
    roomCode: (r: RoomId) => pick(skin.rooms[r]?.code, plain.roomCode(r)),
    slotLabel: (t: SlotIndex) => pick(skin.slots[t], plain.slotLabel(t)),
  };
}

/**
 * The glossary for a case, skinned or not.
 *
 * One call, so that a caller cannot accidentally build the plain one in a
 * place where a skin exists. The controller had eight such places before this
 * wave; that is how a dressed case ends up with hints in the skin's names and
 * a status bar still saying "Suspect C".
 */
export function glossaryFor(frame: CaseFrame, skin: CaseSkin | null): Glossary {
  return skin === null ? defaultGlossary(frame) : skinGlossary(skin, frame);
}
