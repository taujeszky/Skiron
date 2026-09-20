/**
 * What the player is told they did, once the accusation lands.
 *
 * Three ranks, and the thing they are measured against is `investigation.par`
 * — which wave 4 re-anchored on a measurement rather than a guess, and the
 * argument for that lives in `generator/investigation.ts`. What is decided
 * here is only how far past par is still good.
 *
 * **Nothing here can fail a solved case.** A wrong accusation costs a rank
 * and never a win; hints cost a rank and are never withheld. The plan's line
 * is that there is no fail state, and a rating that could say "you did not
 * really solve it" would be one.
 *
 * The bands are generous on purpose. A player meeting par exactly played as
 * well as an undirected search of the whole house, and a player at twice par
 * has still finished a case most people would abandon.
 */

export type Rank = "exemplary" | "sound" | "thorough";

export interface RatingInput {
  actions: number;
  par: number;
  hints: number;
  wrong: number;
}

export interface Rating {
  rank: Rank;
  /** 3, 2 or 1 — for the row of marks on the summing-up screen. */
  marks: number;
  title: string;
  /** What cost a rank, in order. Empty at the top rank. */
  notes: string[];
}

const TITLES: Readonly<Record<Rank, string>> = {
  exemplary: "Exemplary",
  sound: "Sound work",
  thorough: "Thorough",
};

/** How far past par still counts as sound. Measured against nothing yet. */
export const SOUND_MULTIPLE = 2;

export function rate(input: RatingInput): Rating {
  const { actions, par, hints, wrong } = input;
  const notes: string[] = [];

  if (actions > par) {
    notes.push(
      `${actions} moves against a par of ${par}.`,
    );
  }
  if (hints > 0) notes.push(hints === 1 ? "One hint." : `${hints} hints.`);
  if (wrong > 0) {
    notes.push(
      wrong === 1 ? "One wrong accusation." : `${wrong} wrong accusations.`,
    );
  }

  // Top rank is a clean sheet: at or under par, unaided, first name given.
  if (notes.length === 0) {
    return { rank: "exemplary", marks: 3, title: TITLES.exemplary, notes };
  }
  if (actions <= par * SOUND_MULTIPLE && hints <= 2 && wrong <= 1) {
    return { rank: "sound", marks: 2, title: TITLES.sound, notes };
  }
  return { rank: "thorough", marks: 1, title: TITLES.thorough, notes };
}

/** "1 h 04 m", "4 m 12 s", "38 s" — for the summing-up and the stats table. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m`;
  if (m > 0) return `${m} m ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}
