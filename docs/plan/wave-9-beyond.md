# Wave 9 — Beyond the core (optional)

None of this is committed. Each item is a sketch to be planned properly if the owner asks
for it. Do not start any of it on your own initiative.

- **Daily case.** The owner chose to leave this out of the core. A date-seeded case, the
  same for everyone, with streaks, as in Cardscape. With template text it needs no key and
  works offline. A skinned daily case for everyone would need pre-authored cases shipped in
  advance, because there is no backend.
- **Confrontation.** Present a card that contradicts a suspect's statement and watch them
  react. The engine decides whether the card really contradicts the statement; the model
  only voices the reaction. A natural payoff for lying cases.
- **Hungarian.** The skin already carries `language`. It also needs Hungarian template
  sentences in `explain.ts` (case endings make this more than string substitution) and a
  translated interface.
- **More clue types.** The extension set in the README — movement, door use, things heard,
  ordering — each added through the "How to add a clue type" path and justified by the sim
  table.
- **Tauri shell**, following Loopy and Signpost. Persistence is already behind a module for
  this.
- **More providers** (OpenRouter, OpenAI) behind `llm/provider.ts`, as Notus does.
- **Campaigns.** Linked cases in one setting with a recurring cast.
- **A stage in Hash Hunt.** If the owner builds that project, a Skiron case whose answer
  feeds a hunt secret is a natural crossover.
