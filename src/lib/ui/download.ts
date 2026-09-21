/**
 * Handing the browser a file, and taking one back.
 *
 * Small and separate because it is the only DOM-and-`URL.createObjectURL`
 * code in the game layer's neighbourhood, and because the plan wants browser
 * APIs behind modules a Tauri shell can replace (`save` becomes a dialog,
 * `pickFile` becomes one too). Nothing here knows what a case is.
 */

/** Offer `text` to the player as a file called `name`. */
export function save(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // Not appended to the document: a detached anchor's click still triggers
  // the download in every current browser, and appending one leaves a node
  // behind if anything between here and `remove` throws.
  link.click();
  // Revoked on a later task rather than immediately — Safari has historically
  // cancelled the download when the URL went away in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Ask for a file and hand back its text, or null if the player cancelled.
 *
 * Resolves on cancel rather than hanging, which needs the `cancel` event:
 * a file input that is dismissed fires nothing else, and a promise that never
 * settles would leave the button disabled for ever.
 */
export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    input.addEventListener("cancel", () => done(null));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      file
        .text()
        .then((text) => done(text))
        .catch(() => done(null));
    });
    input.click();
  });
}
