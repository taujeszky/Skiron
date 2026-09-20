/**
 * One spine: every store the game shares, and every action that changes one.
 *
 * Components use runes for what is theirs alone — a hovered room, an open
 * accordion — and read this file for everything two of them have to agree
 * about. That is Signpost's shape and the reason for it is the same: a screen
 * that keeps its own copy of the notebook is a screen that can disagree with
 * the notebook.
 *
 * Three rules this file exists to keep, all of them invariants and none of
 * them enforceable by a component:
 *
 * - **The accusation, the Check and the win never go through a solver**
 *   (invariant 5). `accuse` compares with `case.world` and `checkNotebook`
 *   calls `notebookIsSound`, which does the same. A deduction bug can make
 *   the hints useless; it may never hand out or withhold a win.
 * - **A save holds an id and nothing else about the case** (invariant 4 doing
 *   real work). `resume` rebuilds from the id and then checks the rebuilt
 *   frame against the notebook it was handed, because a save written by an
 *   older Skiron can parse perfectly and still describe a different house.
 * - **The card list the player sees is the card list the hints count from.**
 *   `explainer` numbers cards by their position in the list it is given, so
 *   "Card 3" in a hint means Card 3 in the evidence pane only as long as
 *   there is one list. There is one list: `cards`.
 */

import { get, derived, writable } from "svelte/store";
import type { Readable, Writable } from "svelte/store";

import { formatCaseId, newCaseId, parseCaseId } from "$lib/engine/caseId";
import type { CaseId } from "$lib/engine/caseId";
import { ask, examine } from "$lib/engine/generator/bank";
import type { GeneratedCase } from "$lib/engine/generator/generate";
import { difficultyLabel } from "$lib/engine/solver/difficulty";
import { defaultGlossary, explainer } from "$lib/engine/solver/explain";
import type { Explainer, Prose } from "$lib/engine/solver/explain";
import { hint, newNotebook, notebookIsSound } from "$lib/engine/solver/hint";
import type { Hint } from "$lib/engine/solver/hint";
import { topic } from "$lib/engine/types";
// Types and one pure function; nothing here pulls the provider SDK into the
// app bundle, and `glossaryFor` is the only bridge between game and llm.
import { glossaryFor } from "$lib/llm/skin/glossary";
import { LlmError, llmErrorMessage } from "$lib/llm/errors";
import { hasKey, browserKey } from "$lib/llm/key";
import type { Provider } from "$lib/llm/provider";
import { initSkins, skins } from "$lib/llm/skinStore";
import type { CaseSkin } from "$lib/llm/skin/schema";
import type {
  CaseFrame,
  Clue,
  ClueId,
  Glossary,
  PersonId,
  PresetName,
  RoomId,
  SlotIndex,
  TopicKey,
} from "$lib/engine/types";
import { randomSeed } from "$lib/util/entropy";

import { loadCase } from "./cases";
import type { Loading } from "./cases";
import { findErrors } from "./errors";
import type { NotebookError } from "./errors";
import {
  applyConclusion,
  autoNotes,
  canRedo,
  canUndo,
  clearCell,
  cloneNotebook,
  newHistory,
  notebookFits,
  progress,
  push,
  redo,
  setRoom,
  toggleCleared,
  toggleRoom,
  toggleSlot,
  undo,
} from "./notebook";
import type { History, Notebook } from "./notebook";
import { rate } from "./rating";
import type { Rating } from "./rating";
import { recordAbandon, recordSolve, recordStart } from "./stats";
import {
  clearSave,
  initStorage,
  loadSave,
  loadSettings,
  loadStats,
  saveSettings,
  saveStats,
  writeSave,
} from "./storage";
import {
  askKey,
  defaultSettings,
  emptyStats,
  examineKey,
} from "./types";
import type {
  AccusationRecord,
  ChatTurn,
  Save,
  Screen,
  Settings,
  Stats,
} from "./types";

/* ------------------------------------------------------------ the clock */

/**
 * The only clock the game reads, behind a seam so a test can stop time.
 *
 * `engine/` may not touch `Date` at all (invariant 4, and `purity.test.ts`
 * checks it); the game layer may, and this is the one place it does.
 */
let now: () => number = () => Date.now();

export function useClock(fn: () => number): void {
  now = fn;
}

/* ------------------------------------------------------------- the state */

export interface Game {
  id: CaseId;
  /** The formatted id: the share link and the save key in one. */
  text: string;
  case: GeneratedCase;
  /**
   * The LLM's names and prose for this case, or null for the engine's own.
   *
   * Not persisted: `flush` writes ids and marks, and a skin is rebuilt from
   * IndexedDB by case id on resume. Everything that reads a name goes through
   * `glossaryOf` below rather than building its own, which is the whole of
   * wave 5's task 7 — eight separate `defaultGlossary(frame)` calls in this
   * file were how a dressed case would have ended up with cards in the skin's
   * names and a status bar still saying "Suspect C".
   */
  skin: CaseSkin | null;
  /**
   * Every free-text exchange, with everybody, oldest first (wave 6).
   *
   * One list rather than one per suspect, because that is what the save
   * holds and because "the transcript" is a thing the player has, not a
   * property of a person. The pane filters it.
   */
  chat: ChatTurn[];
  history: History;
  /** Cards released by an action, in the order they came. */
  collected: ClueId[];
  /** Distinct actions taken, in order. */
  spent: string[];
  wrong: AccusationRecord[];
  hints: number;
  checks: number;
  /** Milliseconds banked from earlier sessions. */
  ms: number;
  /** When this sitting started, or 0 when the clock is stopped. */
  since: number;
  solved: boolean;
}

export interface LoadingState {
  id: CaseId;
  /** What the spinner says. */
  label: string;
  cancel(): void;
}

/** What the shared hint/check panel is showing. */
export type Panel =
  | { kind: "none" }
  | { kind: "hint"; hint: Hint }
  | { kind: "check"; sound: boolean }
  | { kind: "card"; ids: ClueId[]; from: string }
  | { kind: "nothing"; from: string }
  | { kind: "error"; text: string };

export const screen: Writable<Screen> = writable("home");
export const game: Writable<Game | null> = writable(null);
export const loading: Writable<LoadingState | null> = writable(null);
export const panel: Writable<Panel> = writable({ kind: "none" });
export const settings: Writable<Settings> = writable(defaultSettings());
export const stats: Writable<Stats> = writable(emptyStats());

/* ------------------------------------------------- what the screens share */

/** The slot the map is scrubbed to. */
export const scrubSlot: Writable<SlotIndex> = writable(0);
/** The card whose cells and rooms are lit up, if any. */
export const selectedCard: Writable<ClueId | null> = writable(null);
/** The grid cell the keyboard is on. */
export const focusCell: Writable<{ p: PersonId; t: SlotIndex }> = writable({
  p: 0,
  t: 0,
});
/** Which pane is up on a phone. */
export const pane: Writable<"map" | "notebook" | "evidence"> = writable("notebook");
/**
 * What a tap on a room code in the grid does.
 *
 * Crossing out is the move a player makes twenty times for every one time
 * they place somebody, so it is the default. A mouse can double-click to
 * place and skip the mode entirely; a thumb cannot, which is what the toggle
 * is for.
 */
export const markMode: Writable<"cross" | "place"> = writable("cross");
/** Who is being questioned, or null for the cast list. */
export const questioning: Writable<PersonId | null> = writable(null);
/** The evidence pane's filter. -1 means "any". */
export const evidenceFilter: Writable<{
  person: PersonId;
  slot: SlotIndex;
  room: RoomId;
}> = writable({ person: -1, slot: -1, room: -1 });

/* ---------------------------------------------------------- the derived */

/**
 * Every card the player holds: the opening first, then whatever they have
 * turned up, in the order they turned it up.
 *
 * The order is the card numbering. It has to be stable — a player who reads
 * "Card 3" in a hint and looks for Card 3 in the list must find the same one
 * — so cards are appended and never sorted.
 */
export const cards: Readable<Clue[]> = derived(game, (g) => {
  if (!g) return [];
  const out = [...g.case.opening];
  for (const id of g.collected) {
    const card = g.case.bank.cards.get(id);
    if (card) out.push(card);
  }
  return out;
});

export const notebook: Readable<Notebook | null> = derived(
  game,
  (g) => g?.history.present ?? null,
);

/** The one place a glossary is made. Nothing else in this file may call it. */
function glossaryOf(g: Game): Glossary {
  return glossaryFor(g.case.frame, g.skin);
}

/** The verified prose for this case, or nothing, which means templates. */
function proseOf(g: Game): Prose {
  return g.skin?.prose ?? {};
}

export const glossary: Readable<Glossary | null> = derived(game, (g) =>
  g ? glossaryOf(g) : null,
);

export const explain: Readable<Explainer | null> = derived(
  [game, cards],
  ([g, list]) =>
    g ? explainer(g.case.frame, list, glossaryOf(g), proseOf(g)) : null,
);

export const errors: Readable<NotebookError[]> = derived(game, (g) =>
  g ? findErrors(g.case.frame, g.history.present, glossaryOf(g)) : [],
);

export const marked: Readable<number> = derived(game, (g) =>
  g ? progress(g.case.frame, g.history.present) : 0,
);

export const undoable: Readable<boolean> = derived(game, (g) =>
  g ? canUndo(g.history) : false,
);

export const redoable: Readable<boolean> = derived(game, (g) =>
  g ? canRedo(g.history) : false,
);

/** The rating as it stands. Shown on the summing-up, and only there. */
export const rating: Readable<Rating | null> = derived(game, (g) =>
  g
    ? rate({
        actions: g.spent.length,
        par: g.case.investigation.par,
        hints: g.hints,
        wrong: g.wrong.length,
      })
    : null,
);

/* ------------------------------------------------------------- start-up */

let started = false;

/** Read what is on disk. Safe to call twice; the second call does nothing. */
export function start(): void {
  if (started) return;
  started = true;
  initStorage();
  // The skins live in IndexedDB rather than beside the settings; in Node and
  // wherever IndexedDB is refused this quietly stays an in-memory store, so a
  // case can still be written, just not remembered.
  initSkins();
  // The same database, a second store. `llm/idb.ts` owns the version, and
  // the two stores are created together.
  void import("$lib/llm/artStore").then(({ initArt }) => initArt());
  settings.set(loadSettings());
  stats.set(loadStats());
  applyTheme(get(settings).theme);
}

/** Is there a case waiting to be picked back up? */
export function savedCaseId(): string | null {
  const save = loadSave();
  return save?.id ?? null;
}

/* ------------------------------------------------------------- the clock */

function elapsed(g: Game): number {
  return g.ms + (g.since > 0 ? Math.max(0, now() - g.since) : 0);
}

export function elapsedMs(): number {
  const g = get(game);
  return g ? elapsed(g) : 0;
}

/** Bank the time so far and stop counting. Called when the tab goes away. */
export function pauseClock(): void {
  const g = get(game);
  if (!g || g.since === 0) return;
  game.set({ ...g, ms: elapsed(g), since: 0 });
  flush();
}

export function resumeClock(): void {
  const g = get(game);
  if (!g || g.since > 0 || g.solved) return;
  game.set({ ...g, since: now() });
}

/* ------------------------------------------------------- loading a case */

let inFlight: Loading | null = null;
/** Aborts the writing phase, which `loadCase`'s own cancel knows nothing of. */
let writing: AbortController | null = null;

/**
 * What the player typed in the setting box, if anything.
 *
 * A store rather than a second argument threaded through every caller: the
 * box lives on the home screen and `newCase` is called from four places, and
 * the setting is a property of the next case rather than of the click.
 */
export const setting: Writable<string> = writable("");

export async function newCase(preset: PresetName, dressed?: string): Promise<void> {
  const wanted = (dressed ?? get(setting)).trim();
  await open(newCaseId(preset, randomSeed()), undefined, wanted);
}

export async function openCaseText(text: string): Promise<boolean> {
  const id = parseCaseId(text);
  if (id === null) {
    panel.set({ kind: "error", text: `"${text.trim()}" is not a case number.` });
    return false;
  }
  await open(id);
  return get(game) !== null;
}

/**
 * Pick up where the player left off.
 *
 * The save holds a case id and the player's own marks, so this rebuilds the
 * case and then asks whether the marks still fit it. They can fail to: a save
 * written by an older Skiron parses perfectly and describes a house with a
 * different number of rooms in it. A save that does not fit is dropped, which
 * is the only honest thing to do with it.
 */
export async function resume(): Promise<boolean> {
  const save = loadSave();
  if (!save) return false;
  const id = parseCaseId(save.id);
  if (id === null) {
    clearSave();
    return false;
  }
  await open(id, save);
  return get(game) !== null;
}

/**
 * Open a case that was shipped with the site rather than generated here.
 *
 * The whole case travels in the file — see `llm/pack.ts` for why that is the
 * one exception to invariant 4 — so there is nothing to build and no worker
 * to wait for, and the skin comes with it. Needs no key and no network beyond
 * the file itself, which the service worker has already cached.
 */
export async function openPackCase(id: string, pack?: string): Promise<boolean> {
  cancelLoad();
  loading.set({ id: parseCaseId(id) ?? newCaseId("easy", "0"), label: "Opening the case…", cancel: cancelLoad });
  const { loadPackCase } = await import("$lib/llm/packLoader");
  const loaded = await loadPackCase(id, pack);
  loading.set(null);
  if (!loaded) {
    panel.set({ kind: "error", text: "That case could not be opened." });
    return false;
  }
  const caseId = parseCaseId(loaded.id);
  if (!caseId) return false;
  // Set before `showGame`, which is what reads it. A shipped case's pictures
  // are files that came with the site, so there is nothing to generate and
  // nothing to pay for — which is the whole point of shipping a pack.
  const { DEFAULT_PACK } = await import("$lib/llm/packLoader");
  packArt =
    loaded.images.length > 0
      ? { base: `/cases/${pack ?? DEFAULT_PACK}/${loaded.id}`, keys: loaded.images }
      : null;
  showGame(gameFor(caseId, loaded.case, loaded.skin), undefined);
  return true;
}

async function open(id: CaseId, save?: Save, dress?: string): Promise<void> {
  cancelLoad();
  // A generated case has no shipped pictures. Cleared here rather than left
  // over from whatever was opened before, which would point this case's
  // portraits at another case's files.
  packArt = null;
  const run = loadCase(id);
  inFlight = run;
  loading.set({
    id,
    label: `Building a ${difficultyLabel(id.preset)} case…`,
    cancel: cancelLoad,
  });
  panel.set({ kind: "none" });

  let built: GeneratedCase;
  try {
    built = await run.case;
  } catch (err) {
    if (inFlight === run) {
      inFlight = null;
      loading.set(null);
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "cancelled") {
        panel.set({ kind: "error", text: `That case could not be built: ${message}` });
      }
    }
    return;
  }
  // A second request started while this one was in the air. Its result wins.
  if (inFlight !== run) return;
  inFlight = null;
  loading.set(null);

  const frame = built.frame;
  const fits = save !== undefined && notebookFits(frame, save.notebook);
  const restored = fits ? (save as Save) : undefined;
  if (save !== undefined && !fits) clearSave();

  const held = new Set(built.bank.cards.keys());
  const next: Game = {
    id,
    text: formatCaseId(id),
    case: built,
    // Filled in by `dressCase` once the writing is done, or left null for a
    // case played in the engine's own words.
    skin: null,
    // A turn naming somebody this frame does not have is from a save written
    // against a different house. The notebook check below catches that too,
    // but this one runs whether or not the notebook fits.
    chat: restored ? restored.chat.filter((turn) => turn.who < frame.people) : [],
    // A fresh case starts with whatever the case file already implies — the
    // body's last cell, and anything the movement rules force from it. The
    // headless play-through is what turned this up: auto-notes fired on a
    // collected card and the opening is never collected, so the grid sat
    // blank while the hint panel recited deductions the setting had promised
    // to make. A restored notebook is left exactly as it was saved, because
    // the player may have undone some of it on purpose.
    history: newHistory(
      restored
        ? cloneNotebook(restored.notebook)
        : get(settings).autoNotes
          ? autoNotes(frame, built.opening, newNotebook(frame))
          : newNotebook(frame),
    ),
    // A card id from a save that the rebuilt bank does not hold would be a
    // determinism failure, not a stale save — but dropping it here costs
    // nothing and keeps a broken one from crashing the evidence pane.
    collected: restored ? restored.collected.filter((c) => held.has(c)) : [],
    spent: restored ? restored.spent : [],
    wrong: restored ? restored.wrong : [],
    hints: restored ? restored.hints : 0,
    checks: restored ? restored.checks : 0,
    ms: restored ? restored.ms : 0,
    since: restored?.solved ? 0 : now(),
    solved: restored?.solved ?? false,
  };

  // The writing phase. It runs before the case is shown, because a case whose
  // names change under the player halfway through a sitting would be worse
  // than one that took longer to arrive. Everything here is best-effort: a
  // model that fails, refuses or times out leaves `skin` null and the case is
  // played in the engine's own words, which is exactly what wave 4 shipped.
  next.skin = await dressCase(next, save === undefined ? dress : undefined, id);

  showGame(next, restored);
}

/**
 * Put a finished game on screen.
 *
 * Shared by the two ways a case arrives — generated here, or read out of a
 * shipped pack — so that a pack case gets the same reset, the same stats
 * entry and the same landing screen as any other. Anything that only happened
 * on one of those paths would be a difference nobody meant.
 */
function showGame(next: Game, restored: Save | undefined): void {
  game.set(next);
  scrubSlot.set(0);
  selectedCard.set(null);
  focusCell.set({ p: 0, t: 0 });
  questioning.set(null);
  evidenceFilter.set({ person: -1, slot: -1, room: -1 });

  if (!restored) {
    stats.update((s) => {
      const out = recordStart(s, next.case.difficulty);
      saveStats(out);
      return out;
    });
  }
  flush();
  if (!restored) screen.set("briefing");
  else screen.set(restored.solved ? "summary" : "investigate");

  // Last, and not awaited. The case is already on screen and playable; the
  // faces catch up. See `startArt`.
  startArt(next);
}

/** A fresh `Game` around a case that is already built. */
function gameFor(id: CaseId, built: GeneratedCase, skin: CaseSkin | null): Game {
  return {
    id,
    text: formatCaseId(id),
    case: built,
    skin,
    chat: [],
    history: newHistory(
      get(settings).autoNotes
        ? autoNotes(built.frame, built.opening, newNotebook(built.frame))
        : newNotebook(built.frame),
    ),
    collected: [],
    spent: [],
    wrong: [],
    hints: 0,
    checks: 0,
    ms: 0,
    since: now(),
    solved: false,
  };
}

/* ------------------------------------------------------- the writing phase */

/**
 * Find or write this case's skin.
 *
 * Three ways out, and only one of them involves a model:
 *
 * - A case that has been dressed before is read back from IndexedDB, so
 *   resuming does not pay for the prose twice and works with no key at all.
 * - A player who typed no setting, or has no key, gets `null` and the engine's
 *   own sentences. That is not a degraded mode — it is what the whole of wave
 *   4 shipped as, and the puzzle stands up in it.
 * - Otherwise the model writes it, and **any** failure still returns `null`.
 *   A quota error, a safety refusal, a timeout or a malformed answer must not
 *   cost the player a finished, fair, perfectly playable case.
 *
 * A cancel is the one thing treated differently: it aborts the writing, and
 * the case still opens, because the player asked for the waiting to stop
 * rather than for the case to be thrown away.
 */
async function dressCase(
  g: Game,
  wanted: string | undefined,
  id: CaseId,
): Promise<CaseSkin | null> {
  const key = formatCaseId(id);

  const stored = await skins().get(key);
  if (stored) return stored;
  if (!wanted || wanted.trim() === "" || !hasKey()) return null;

  const controller = new AbortController();
  writing = controller;
  const say = (label: string) =>
    loading.set({ id, label, cancel: cancelLoad });
  say("Writing the case…");

  try {
    const { geminiProvider } = await import("$lib/llm/gemini");
    const { authorSkin } = await import("$lib/llm/skin/author");
    const out = await authorSkin(
      geminiProvider({ key: browserKey() }),
      g.case,
      {
        setting: wanted.trim(),
        signal: controller.signal,
        onStage: (stage) => {
          if (stage.kind === "writing") say("Writing the case…");
          else if (stage.kind === "checking") {
            say(`Checking the writing… ${stage.verified} of ${stage.of}`);
          } else if (stage.kind === "rewriting") {
            const n = stage.count;
            say(`Rewriting ${n} ${n === 1 ? "passage" : "passages"}…`);
          } else say("Writing the summing-up…");
        },
      },
    );
    await skins().put(key, out.skin);
    return out.skin;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "cancelled") {
      // Said once, on the case itself, rather than as an error screen: the
      // case is fine and the player can play it.
      panel.set({
        kind: "error",
        text: `The case is ready, but could not be written: ${message}`,
      });
    }
    return null;
  } finally {
    if (writing === controller) writing = null;
  }
}

/** Is there a key, so the home screen can offer the setting box at all? */
export function canDress(): boolean {
  return hasKey();
}

/* --------------------------------------------------------- wave 7: the art */

/**
 * Every picture this case has, by subject key, as something `<img src>` takes.
 *
 * A store rather than a field of `Game`, for the reason the whole wave turns
 * on: **art arrives after the case does.** A field would mean setting `game`
 * again for every portrait that lands, and every screen re-deriving from a
 * case that has not changed. This moves on its own, and only the two
 * components that show a face subscribe to it.
 *
 * Empty is the normal state, not a failure. It is what every case looked like
 * through wave 6, what a case with no key looks like, and what a case looks
 * like for the first ten seconds regardless — so both readers fall back to
 * `look.ts#monogramUrl`, which needs nothing and cannot fail.
 */
export const artUrls: Writable<Record<string, string>> = writable({});

let painting: AbortController | null = null;
/**
 * Which art run is the current one.
 *
 * A ticket rather than a comparison of case ids, and the difference matters:
 * reopening the *same* case — abandon it, open it again — leaves the first
 * run's id matching perfectly, so an id check would let both proceed and pay
 * for every picture twice. A counter cannot be fooled that way. `startArt`
 * takes a number and every `await` in it is followed by a check that it is
 * still the number.
 */
let artRun = 0;
/**
 * Where a shipped case's pictures are, if it has any.
 *
 * Module state beside `inFlight` and `writing`, and for the same reason: it
 * belongs to the case currently being opened, not to the save and not to the
 * game object that two other code paths construct.
 */
let packArt: { base: string; keys: string[] } | null = null;

/** Injected by tests, exactly as `useAskProvider` is. */
let artProvider: (() => Provider) | null = null;

export function useArtProvider(make: (() => Provider) | null): void {
  artProvider = make;
}

/** Hand every object URL back before dropping the lot. */
function clearArt(): void {
  const urls = get(artUrls);
  artUrls.set({});
  void import("$lib/llm/artStore").then(({ releaseUrl }) => {
    // Only the ones this app minted: a shipped case's pictures are ordinary
    // paths and revoking one would be meaningless rather than harmful.
    for (const url of Object.values(urls)) if (url.startsWith("blob:")) releaseUrl(url);
  });
}

export function cancelArt(): void {
  painting?.abort();
  painting = null;
  // Retires whatever run is in flight, including one that has not reached
  // its AbortController yet.
  artRun++;
}

/**
 * Put the pictures on screen, and paint the missing ones.
 *
 * **Called after `showGame`, never before it, and never awaited.** That is the
 * one rule here and it is the opposite of `dressCase`, which is deliberately
 * awaited: names changing under a player mid-sitting would be worse than a
 * longer wait, whereas a face appearing is not a change to anything the
 * player has read. A picture must never be a reason the case is not yet on
 * screen.
 *
 * Three sources, in order of how fast they answer: a shipped pack's files,
 * IndexedDB from an earlier sitting, and finally the model.
 */
function startArt(g: Game): void {
  cancelArt();
  clearArt();
  const id = g.text;
  const mine = ++artRun;
  const current = () => artRun === mine;
  const shipped = packArt;

  void (async () => {
    try {
      if (shipped) {
        // Nothing to fetch and nothing to decode: the service worker has
        // these already and the browser will do the rest.
        const from: Record<string, string> = {};
        for (const key of shipped.keys) from[key] = `${shipped.base}/${key}.webp`;
        artUrls.update((shown) => ({ ...from, ...shown }));
        return;
      }

      const { art, imageUrl } = await import("$lib/llm/artStore");
      const store = art();
      const had = await store.keys(id);
      for (const key of had) {
        const stored = await store.get(id, key);
        const url = stored ? imageUrl(stored) : null;
        if (url) artUrls.update((shown) => ({ ...shown, [key]: url }));
      }
      // Still the run that is wanted? A player who went back to the desk,
      // or reopened this very case, must not get the old run's faces.
      if (!current()) return;

      const quality = get(settings).imageQuality;
      if (quality === "off" || !g.skin || !hasKey()) return;

      const { artMaterial } = await import("$lib/llm/art/prompts");
      const { generateArt } = await import("$lib/llm/art/art");
      const material = artMaterial(g.skin, {
        victim: g.case.frame.victim,
      });
      const have = new Set(had);
      if (material.subjects.every((s) => have.has(s.key))) return;

      const controller = new AbortController();
      painting = controller;
      const provider = artProvider
        ? artProvider()
        : await import("$lib/llm/gemini").then(({ geminiProvider }) =>
            geminiProvider({ key: browserKey() }),
          );

      // Asked twice, and the second time is the one that matters. Between the
      // check above and this line are two dynamic imports and a provider
      // construction, and a player who left in that window would otherwise be
      // charged for a case nobody is looking at. Found by `art.test.ts`,
      // which was getting three calls where one was due.
      if (!current() || controller.signal.aborted) return;

      await generateArt(provider, material, {
        quality,
        signal: controller.signal,
        have: (key) => have.has(key),
        onImage: async (key, image) => {
          await store.put(id, key, image);
          // Shown the moment it exists, rather than when the run finishes:
          // portraits arrive over tens of seconds and the player is already
          // reading the briefing. Stored either way — it is paid for, and the
          // next sitting should not buy it again.
          if (!current()) return;
          const url = imageUrl({ mime: image.mime, bytes: image.bytes });
          if (url) artUrls.update((shown) => ({ ...shown, [key]: url }));
        },
      });
    } catch {
      // Every failure here costs a picture and nothing else. There is no
      // error panel for this on purpose: a player who never turned art on
      // does not want to hear that it did not happen, and one who did still
      // has a complete, fair, perfectly playable case.
    } finally {
      if (painting?.signal.aborted !== false) painting = null;
    }
  })();
}

export function cancelLoad(): void {
  const run = inFlight;
  inFlight = null;
  if (run) run.cancel();
  writing?.abort();
  writing = null;
  // A question still in the air belongs to the case being replaced.
  cancelQuestion();
  cancelArt();
  loading.set(null);
}

/**
 * Put the case down without solving it.
 *
 * The streak breaks and the save goes. Giving up is not a wrong answer, so
 * nothing else in the stats moves — see `stats.ts`.
 */
export function abandon(): void {
  const g = get(game);
  if (g && !g.solved) {
    stats.update((s) => {
      const out = recordAbandon(s, g.case.difficulty);
      saveStats(out);
      return out;
    });
  }
  cancelQuestion();
  cancelArt();
  clearArt();
  game.set(null);
  panel.set({ kind: "none" });
  clearSave();
  screen.set("home");
}

/* ----------------------------------------------------------- the actions */

/**
 * Ask a suspect about something.
 *
 * A repeat is free: the question has been paid for, the answer has not
 * changed, and charging for it again would teach the player to keep notes on
 * what they had already asked instead of playing. The interface shows an
 * asked question as asked for the same reason.
 */
export function askAbout(suspect: PersonId, key: TopicKey): void {
  const g = get(game);
  if (!g || g.solved) return;
  take(g, askKey(suspect, key), ask(g.case.bank, suspect, key), describeAsk(g, suspect, key));
}

export function examineRoom(room: RoomId): void {
  const g = get(game);
  if (!g || g.solved) return;
  const gloss = glossaryOf(g);
  take(g, examineKey(room), examine(g.case.bank, room), `You search ${gloss.roomName(room)}.`);
}

function describeAsk(g: Game, suspect: PersonId, key: TopicKey): string {
  const gloss = glossaryOf(g);
  const who = gloss.personName(suspect);
  if (key === topic.motive) return `You ask ${who} about themselves.`;
  const [kind, raw] = key.split(":");
  const n = Number(raw);
  if (kind === "slot") return `You ask ${who} about ${gloss.slotLabel(n)}.`;
  if (kind === "room") return `You ask ${who} about ${gloss.roomName(n)}.`;
  return `You ask ${who} about ${gloss.personName(n)}.`;
}

function take(g: Game, key: string, released: readonly ClueId[], from: string): void {
  const spent = g.spent.includes(key) ? g.spent : [...g.spent, key];
  const collected = [...g.collected];
  const fresh: ClueId[] = [];
  for (const id of released) {
    if (collected.includes(id)) continue;
    if (!g.case.bank.cards.has(id)) continue;
    collected.push(id);
    fresh.push(id);
  }

  let history = g.history;
  if (fresh.length > 0 && get(settings).autoNotes) {
    const held = [...g.case.opening];
    for (const id of collected) {
      const card = g.case.bank.cards.get(id);
      if (card) held.push(card);
    }
    history = push(history, autoNotes(g.case.frame, held, history.present));
  }

  game.set({ ...g, spent, collected, history });
  panel.set(
    released.length === 0
      ? { kind: "nothing", from }
      : { kind: "card", ids: [...released], from },
  );
  flush();
}

/** Has this question already been put? For greying out the cast list. */
export function alreadyAsked(key: string): boolean {
  return get(game)?.spent.includes(key) ?? false;
}

/* --------------------------------------------------- questions in words */

/**
 * Wave 6. The same questions, typed instead of picked.
 *
 * Free text is a layer *over* the picker and never beside it: a typed
 * question is routed to one of the picker's topics and then released by
 * `askAbout`, which is the only path in the game that hands over a card. So
 * the move is spent once, the auto-notes fire, the evidence pane and the
 * panel update, and the save is flushed — all of it by the same code a
 * button press goes through. Reimplementing any of that here would let the
 * notebook and the evidence pane drift apart with no symptom until somebody
 * noticed a card that had never been written down.
 *
 * The exit criterion is that a case is solvable either way with the same
 * cards available, and this is how that is true rather than merely intended.
 */

/** Who is waiting on a model, or null. The chat's "thinking" line reads it. */
export const answering: Writable<PersonId | null> = writable(null);

/** The transcript, oldest first. The pane filters it by who. */
export const chat: Readable<ChatTurn[]> = derived(game, (g) => g?.chat ?? []);

/** Long enough for an evening; short enough that a save stays small. */
const MAX_CHAT_TURNS = 400;

/**
 * What a person says when the skin's own line cannot be used.
 *
 * It asserts nothing — which is the point, and is why it is safe where an
 * unchecked written line is not. See `llm/interrogate/guards.ts#safeSilence`.
 */
export const PLAIN_SILENCE = "I've nothing to tell you about that.";

let inWords: AbortController | null = null;

/**
 * Where the interrogation's model comes from, behind a seam so a test can
 * supply `llm/stub.ts`.
 *
 * The same shape as `useClock`, `useLoader` and `useSkins` above, and for the
 * same reason: this is the one action in the game that makes a model call
 * while a player is waiting, and every test of it has to run with no key and
 * no network. Left null, the real client is imported only when a question is
 * actually asked, so the SDK stays out of the bundle a player downloads to
 * play in the engine's own words.
 */
let askProvider: (() => Provider) | null = null;

export function useAskProvider(make: (() => Provider) | null): void {
  askProvider = make;
}

/** Stop waiting on a reply. The card, if one was released, stays released. */
export function cancelQuestion(): void {
  inWords?.abort();
  inWords = null;
  answering.set(null);
}

/** Free text needs a key to call with and a skin to have a voice. */
export function canConverse(): boolean {
  const g = get(game);
  return g !== null && g.skin !== null && hasKey();
}

function addTurn(turn: ChatTurn): void {
  const g = get(game);
  if (!g) return;
  const next = [...g.chat, turn];
  game.set({ ...g, chat: next.slice(-MAX_CHAT_TURNS) });
  flush();
}

/**
 * The other name for a topic, or nothing.
 *
 * A role is offered only when it is one of a kind: two guests called "a
 * guest" would make "did the guest say anything?" genuinely ambiguous, and a
 * router that answered `too_broad` to it would be right. Handing it two
 * identical aliases would only teach it to guess.
 */
function aliasFor(g: Game, group: string, key: TopicKey): string | undefined {
  if (group === "room") return glossaryOf(g).roomCode(Number(key.slice(5)));
  if (group !== "person" || !g.skin) return undefined;
  const role = g.skin.people[Number(key.slice(7))]?.role?.trim();
  if (!role) return undefined;
  const same = g.skin.people.filter(
    (p) => (p.role ?? "").trim().toLowerCase() === role.toLowerCase(),
  );
  return same.length === 1 ? role : undefined;
}

/** What a person is, for the cast strip and for the router. */
export function roleOf(g: Game, person: PersonId): string {
  return g.skin?.people[person]?.role?.trim() ?? "";
}

function historyWith(g: Game, suspect: PersonId): { from: "player" | "suspect"; text: string }[] {
  const out: { from: "player" | "suspect"; text: string }[] = [];
  for (const turn of g.chat) {
    // A note is the game apologising for a failure, not a thing anybody said.
    if (turn.who !== suspect || turn.from === "note") continue;
    out.push({ from: turn.from, text: turn.text });
  }
  return out;
}

/**
 * The engine's half of a typed question, and the only route from the
 * interrogation module to a bank.
 *
 * The sentences come from `explain`, not from `skin.prose`. They differ
 * exactly when a card fell back to the template, and that is the one card a
 * player is most likely to read twice — so the chat and the evidence pane
 * must quote the same words or they will disagree in public.
 */
function releaseTo(suspect: PersonId, key: TopicKey): { ids: ClueId[]; sentences: string[] } {
  const before = get(game);
  if (!before) return { ids: [], sentences: [] };
  const ids = [...ask(before.case.bank, suspect, key)];
  askAbout(suspect, key);

  const after = get(game);
  const ex = get(explain);
  if (!after || !ex) return { ids, sentences: [] };
  const sentences: string[] = [];
  for (const id of ids) {
    const clue = after.case.bank.cards.get(id);
    if (clue) sentences.push(ex.clue(clue));
  }
  return { ids, sentences };
}

export async function putQuestion(suspect: PersonId, question: string): Promise<void> {
  const g = get(game);
  const text = question.trim();
  if (!g || g.solved || text === "" || get(answering) !== null) return;
  if (!canConverse()) return;

  // Before the question joins the transcript, or it would be in the prompt
  // twice: once as the history's last line and once as the question itself.
  const history = historyWith(g, suspect);
  addTurn({ who: suspect, from: "player", text });

  const controller = new AbortController();
  inWords = controller;
  answering.set(suspect);
  try {
    const [{ askInWords }, { forbiddenLabels }] = await Promise.all([
      import("$lib/llm/interrogate/ask"),
      import("$lib/llm/interrogate/guards"),
    ]);
    const provider =
      askProvider !== null
        ? askProvider()
        : (await import("$lib/llm/gemini")).geminiProvider({ key: browserKey() });
    const now = get(game);
    if (!now) return;
    const gloss = glossaryOf(now);
    const frame = now.case.frame;
    const person = now.skin?.people[suspect];

    const outcome = await askInWords(
      provider,
      {
        question: text,
        suspect: gloss.personName(suspect),
        persona: {
          name: gloss.personName(suspect),
          role: person?.role ?? "",
          bio: person?.bio ?? "",
          voice: person?.voice ?? "",
        },
        motive: person?.motive ?? "",
        // Every topic, never a filtered list — see the note in `classify.ts`.
        topics: topicsFor(frame, suspect, gloss).map((t) => ({
          key: t.key,
          label: t.label,
          group: t.group,
          // The other name a player is likely to use: the grid's column
          // heading for a room, somebody's job for a person. Both are on
          // screen — the heading in the notebook, the job beside the name
          // when you question them — so neither tells the model anything the
          // player has not already got.
          alias: aliasFor(now, t.group, t.key),
        })),
        history,
        forbidden: forbiddenLabels(frame, gloss),
        silence: now.skin?.silence[suspect] ?? "",
        plainSilence: PLAIN_SILENCE,
        release: (key) => releaseTo(suspect, key),
      },
      { signal: controller.signal },
    );

    addTurn({
      who: suspect,
      from: "suspect",
      text: outcome.text,
      ...(outcome.cards.length > 0 ? { cards: outcome.cards } : {}),
    });
  } catch (cause) {
    const error = LlmError.from(cause);
    // A cancel is the player's own doing and needs no apology. Everything
    // else leaves a line in the transcript, because a question that vanished
    // without a word would read as the game ignoring them.
    if (error.kind !== "cancelled") {
      addTurn({ who: suspect, from: "note", text: llmErrorMessage(error) });
    }
  } finally {
    if (inWords === controller) inWords = null;
    answering.set(null);
  }
}

/* ---------------------------------------------------------- the notebook */

function edit(fn: (frame: CaseFrame, n: Notebook) => Notebook): void {
  const g = get(game);
  if (!g || g.solved) return;
  const next = push(g.history, fn(g.case.frame, g.history.present));
  if (next === g.history) return;
  game.set({ ...g, history: next });
  flush();
}

export function markRoom(p: PersonId, t: SlotIndex, r: RoomId): void {
  edit((_, n) => toggleRoom(n, p, t, r));
}

export function placeIn(p: PersonId, t: SlotIndex, r: RoomId): void {
  edit((frame, n) => setRoom(frame, n, p, t, r));
}

export function wipeCell(p: PersonId, t: SlotIndex): void {
  edit((_, n) => clearCell(n, p, t));
}

export function clearSuspect(s: PersonId): void {
  edit((_, n) => toggleCleared(n, s));
}

export function ruleOutSlot(t: SlotIndex): void {
  edit((_, n) => toggleSlot(n, t));
}

export function undoMark(): void {
  const g = get(game);
  if (!g) return;
  const next = undo(g.history);
  if (next === g.history) return;
  game.set({ ...g, history: next });
  flush();
}

export function redoMark(): void {
  const g = get(game);
  if (!g) return;
  const next = redo(g.history);
  if (next === g.history) return;
  game.set({ ...g, history: next });
  flush();
}

export function resetMarks(): void {
  edit((frame) => newNotebook(frame));
}

/* -------------------------------------------------------- hints and check */

/**
 * A hint, and what it costs.
 *
 * It is charged once per *distinct* hint. A player who presses H twice
 * without having done anything in between gets the same sentence, and
 * charging for it again would only be charging them for not trusting the
 * interface.
 */
export function askForHint(): void {
  const g = get(game);
  if (!g || g.solved) return;
  const h = hint({
    frame: g.case.frame,
    cards: get(cards),
    notebook: g.history.present,
    world: g.case.world,
    essential: g.case.essential,
    glossary: glossaryOf(g),
  });
  const shown = get(panel);
  const repeat = shown.kind === "hint" && shown.hint.text === h.text;
  if (!repeat) game.set({ ...g, hints: g.hints + 1 });
  panel.set({ kind: "hint", hint: h });
  flush();
}

/**
 * The Check: one bit, straight from the truth (invariant 5).
 *
 * It does not say which cell, and it must not: the cell is the answer, one
 * square at a time.
 */
export function checkNotebook(): void {
  const g = get(game);
  if (!g) return;
  const sound = notebookIsSound(g.case.frame, g.history.present, g.case.world);
  game.set({ ...g, checks: g.checks + 1 });
  panel.set({ kind: "check", sound });
  flush();
}

export function closePanel(): void {
  panel.set({ kind: "none" });
}

/**
 * Do what the hint on screen says.
 *
 * A deduction gets written into the notebook; an instruction to go and ask
 * somebody something takes that action. Neither is charged for again — the
 * hint has already been paid for, and making the player re-enter the advice
 * by hand would only be charging them for reading.
 *
 * It exists because the hints are the headless play-through's only input:
 * that test drives the real app and follows the advice, so "follow the
 * advice" has to be a thing the app can do.
 */
export function followHint(): void {
  const shown = get(panel);
  if (shown.kind !== "hint") return;
  const g = get(game);
  if (!g || g.solved) return;
  const h = shown.hint;
  if (h.kind === "deduction") {
    const next = push(g.history, applyConclusion(g.case.frame, g.history.present, h.step.conclusion));
    if (next !== g.history) {
      game.set({ ...g, history: next });
      flush();
    }
    askForHint();
    return;
  }
  if (h.kind === "investigate") {
    if (h.ask !== null) askAbout(h.ask, h.topic);
    else examineRoom(Number(h.topic.slice(5)));
  }
}

/** Is the hint on screen one that `followHint` can act on? */
export function hintIsActionable(p: Panel): boolean {
  return (
    p.kind === "hint" && (p.hint.kind === "deduction" || p.hint.kind === "investigate")
  );
}

/* ------------------------------------------------------- the accusation */

export interface Verdict {
  right: boolean;
  culprit: PersonId;
  slot: SlotIndex;
}

/**
 * Name the killer and the hour.
 *
 * Compared with the stored truth and with nothing else. No solver is
 * consulted, so no deduction bug can invent a win or refuse a real one
 * (invariant 5). `case.answer` says the same thing and is not used, because
 * `world` is the thing the simulation actually produced and `answer` is a
 * copy of it.
 */
export function accuse(culprit: PersonId, slot: SlotIndex): Verdict {
  const g = get(game);
  if (!g) return { right: false, culprit, slot };
  const right =
    culprit === g.case.world.culprit && slot === g.case.world.murderSlot;

  if (!right) {
    game.set({ ...g, wrong: [...g.wrong, { culprit, slot }] });
    flush();
    return { right, culprit, slot };
  }

  const ms = elapsed(g);
  const solvedGame: Game = { ...g, solved: true, ms, since: 0 };
  game.set(solvedGame);
  stats.update((s) => {
    const out = recordSolve(s, {
      difficulty: g.case.difficulty,
      actions: g.spent.length,
      par: g.case.investigation.par,
      ms,
      hints: g.hints,
      wrong: g.wrong.length,
    });
    saveStats(out);
    return out;
  });
  flush();
  screen.set("summary");
  return { right, culprit, slot };
}

/**
 * The cards the summing-up numbers against.
 *
 * The trace names cards from the proof set, and a player need not have
 * collected all of them — so the list is what they hold, followed by
 * whatever the proof used and they never found. Their own cards keep the
 * numbers they had all game, and every id in the trace resolves to something.
 */
export const summingUpCards: Readable<Clue[]> = derived(
  [game, cards],
  ([g, held]) => {
    if (!g) return [];
    const have = new Set(held.map((c) => c.id));
    return [...held, ...g.case.clues.filter((c) => !have.has(c.id))];
  },
);

export const summingUp: Readable<string[]> = derived(
  [game, summingUpCards],
  ([g, list]) => {
    if (!g) return [];
    const ex = explainer(g.case.frame, list, glossaryOf(g), proseOf(g));
    return g.case.trace.map((step) => ex.step(step));
  },
);

/* -------------------------------------------------------------- settings */

export function updateSettings(patch: Partial<Settings>): void {
  const wasOn = get(settings).autoNotes;
  settings.update((s) => {
    const out = { ...s, ...patch };
    saveSettings(out);
    if (patch.theme !== undefined) applyTheme(out.theme);
    return out;
  });
  // Switching auto-notes on catches the grid up, rather than starting from
  // whenever the next card happens to arrive. Switching it off leaves what it
  // has already written, because those marks are true and rubbing them out
  // would be the setting undoing the player's progress.
  if (patch.autoNotes === true && !wasOn) catchUp();
}

function catchUp(): void {
  const g = get(game);
  if (!g || g.solved) return;
  const next = push(g.history, autoNotes(g.case.frame, get(cards), g.history.present));
  if (next === g.history) return;
  game.set({ ...g, history: next });
  flush();
}

let themeWatcher: MediaQueryList | null = null;

/**
 * Light, dark or whatever the machine says.
 *
 * `app.css` keys everything off `data-theme` on the root element, so "auto"
 * is resolved here rather than by a media query in the stylesheet — and the
 * listener stays attached, so a player who changes their system theme
 * mid-case sees it change under them.
 */
export function applyTheme(choice: Settings["theme"]): void {
  if (typeof document === "undefined") return;
  const media =
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const resolve = () => {
    const dark = choice === "dark" || (choice === "auto" && (media?.matches ?? false));
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  if (themeWatcher) themeWatcher.onchange = null;
  themeWatcher = choice === "auto" ? media : null;
  if (themeWatcher) themeWatcher.onchange = resolve;
  resolve();
}

/* ---------------------------------------------------------- persistence */

/** Write the save. Called after anything that changes it; cheap enough to be. */
export function flush(): void {
  const g = get(game);
  if (!g) return;
  const save: Save = {
    id: g.text,
    collected: g.collected,
    spent: g.spent,
    notebook: g.history.present,
    wrong: g.wrong,
    hints: g.hints,
    checks: g.checks,
    ms: elapsed(g),
    solved: g.solved,
    chat: g.chat,
  };
  writeSave(save);
}

/* ------------------------------------------------------------ the extras */

/** Every topic a suspect can be asked about, in the order the cast list shows. */
export function topicsFor(
  frame: CaseFrame,
  suspect: PersonId,
  gloss: Glossary = defaultGlossary(frame),
): { key: TopicKey; label: string; group: "slot" | "person" | "room" | "motive" }[] {
  const out: {
    key: TopicKey;
    label: string;
    group: "slot" | "person" | "room" | "motive";
  }[] = [];
  for (let t = 0; t < frame.slots; t++) {
    out.push({ key: topic.slot(t), label: gloss.slotLabel(t), group: "slot" });
  }
  for (let p = 0; p < frame.people; p++) {
    if (p === suspect) continue;
    out.push({ key: topic.person(p), label: gloss.personName(p), group: "person" });
  }
  for (let r = 0; r < frame.plan.rooms.length; r++) {
    out.push({ key: topic.room(r), label: gloss.roomName(r), group: "room" });
  }
  out.push({ key: topic.motive, label: "Themselves", group: "motive" });
  return out;
}

export function goto(next: Screen): void {
  screen.set(next);
}
