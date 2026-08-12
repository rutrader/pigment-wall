# Pigment

A macOS menu-bar app. Each day gives you one grayscale pixel-art image. It
colorizes as you burn AI tokens, read from your local Claude Code session logs.
Past days stay on a wall, each frozen at however filled it got.

> The image is a mirror with a sharp tongue.

The full design is [`docs/SPEC.md`](docs/SPEC.md) — fourteen settled decisions
with the measurement behind each, and an appendix of what was rejected and why.
It is the contract; this README only says how to run what exists.

## Status: M2 — it lives

A menu-bar app: a template tray icon that fills as you burn tokens, and a
popover with today's picture and the wall of days behind it.

M1 built the whole engine headless first — tailing, day bucketing, the
controller, the seal store, backfill — because `q` and `k` cannot be tuned by
*using* the app; that is three weeks per experiment. They are tuned by replaying
sixty days in half a second. That half is still the part with all the decisions
in it.

```sh
npm start         # build and run the app
```

```sh
npm test          # 95 tests, no test dependencies
npm run typecheck
npm run replay    # your real history through the controller, as ASCII
npm run sweep     # grid over q and k, to check the constants against your data
npm run package   # -> out/Pigment.app (ad-hoc signed; needed for notifications)
npm run notarize  # Developer ID only: notarize and staple for distribution
node src/tools/preview.ts --ascii   # look at the pictures at each fill level
```

`replay` takes `--days=60 --q=0.4 --k=0.15 --boundary=4`.

```
day            tokens   target  fill  bar                        tier   cost
2026-08-02     338738    94742  358%  ######################## +++++  t1    $65.84
2026-08-03     853830   100600  400%  ######################## ++++++  t1   $315.63
2026-08-06     134552   120441  112%  ########################    t2    $70.06
2026-08-09      73716   144194   51%  ############············    t3    $21.74

completed 18/29 active days (62%) · overexposed ≥2× on 10 · tier mix t1:15 t2:11 t3:7
```

The `+` run past the end of the bar is overshoot — SPEC §7 renders it as bloom
and bleach rather than discarding it.

`src/core/app.ts` is the seam M2 builds on: `start()` backfills, `tick()` reads
only what was appended, and both return today's day plus the whole wall. It is
the only thing the Electron layer should need to call.

## The two knobs: `q` and `k`

The whole adaptive loop is two numbers. Everything else is bookkeeping.

### `q` — how hard the target is

Every day the app picks a number of tokens you need to hit. `q` decides where
that number sits in your own personal range.

`q = 0.4` means *put the bar at roughly your 40th-percentile day*. 40% of your
days fall below it, 60% land above — so **60% of your working days finish the
picture**. That is the entire meaning of `q`.

| `q` | Bar sits at | Days that complete |
| --- | --- | --- |
| 0.30 | your 30th-percentile day | 72% |
| 0.35 | your 35th-percentile day | 66% |
| **0.40** | **your 40th-percentile day** | **62%** |
| 0.45 | your 45th-percentile day | 55% |
| 0.50 | your median day | 52% |

(Measured, not theoretical — `npm run sweep` produced these against real logs.)

`q` *is* the win rate, just written from the other direction.

### `k` — how fast the bar reacts

Each day the bar nudges up or down depending on whether you beat it. `k` is the
size of that nudge.

At `k = 0.15`:

- you smash the target → tomorrow's bar rises about **6%**
- you miss it → tomorrow's bar falls about **9%**

Small nudges, so the bar takes weeks to really move. That is deliberate: one
heroic Tuesday should not make Wednesday punishing, and one bad afternoon should
not make the app go soft on you. At `k = 0.30` a three-day slump drops the bar
25% — the app visibly flinching the moment you struggle. At `k = 0.05` it barely
moves at all.

### Together

`q` says *where* the bar settles. `k` says *how fast it gets there* and how
twitchy it is on the way. Roughly: `q` is the thermostat's temperature setting,
`k` is how aggressively the heating responds.

### The trap

`k` has a second job nobody assigned it. The picture's complexity tier is
decided by comparing today's bar against where the bar has been recently — so if
`k` is small, the bar never moves far enough from its own trailing average, and
the tier never changes. **At `k = 0.05` the hardest tier did not appear once in
60 days.**

So `k` cannot be tuned purely for feel. Smooth the loop too far and a whole
visible feature quietly stops existing. Run `npm run sweep` and check the `tiers`
column before changing it.

## Adding pictures

```sh
node src/tools/import-png.ts my-art.png --tier=3 --id=cassette
```

Turns a PNG into a drawing. It finds the artist's grid rather than downsampling
— pixel art exported at 19× is recovered as the 64×64 picture it actually is —
extracts the palette, and writes `src/art/imported/<id>.ts`. Register it in
`LIBRARY` and it enters rotation.

It prints the palette it found and guesses two fields you should check by eye:
`order` (which colour gains colour next — subject first) and `background`
(what the tray icon leaves out of the silhouette). Re-run with `--order=` and
`--background=` to correct them.

Which picture a day gets is a **shuffled deck**, not a hash: every picture in a
tier is dealt once before any repeats, so the same image can never appear two
days running.

## The pictures are placeholders

`src/art/library.ts` holds thirteen drawings — twelve authored, one imported — each authored as a
short list of shapes rather than a hand-typed pixel grid — real composition,
and one drawing renders at 16, 32 or 48px without being redrawn. They are
scaffolding: good enough to prove the mechanic, not the final art. Replacing one
means writing a new `Drawing` and nothing else.

Each drawing carries a fill `order` (subject first, background last) and a
`background` list marking which entries are scenery, which is what gives the
tray icon a silhouette to fill.

## Roasts

Six conditions — an all-time record, a fast hour, a comeback, a late session, a
dead day, an overshoot — each with four lines and a thirty-day repeat filter.
Only the first four may raise a notification, capped at one a day; a dead day
and an overshoot get a line in the popover but never interrupt, because the app
does not scold you for resting and a condition that fires on 30% of days is not
a surprise. Toggle is the first item in the tray menu.

Replayed over the last 34 real days that comes to **1.4 notifications a week**.

**Notifications need a packaged build.** Run via `npm start` they fail with
`UNErrorDomain error 1` — macOS grants notification rights to bundles, not to a
bare `electron .`. Run `npm run package` and launch `out/Pigment.app` once to
approve the permission prompt. Every roast appears in the popover either way.

## Distribution

`npm run package` builds `out/Pigment.app` with no packaging dependency — it
copies Electron.app, drops the bundle in and rewrites six Info.plist keys. It
signs ad-hoc by default, which is enough to run locally and enough for
notifications.

If a *Developer ID Application* certificate is in the keychain it signs with
that instead, adding the hardened runtime and the two entitlements Electron
needs (JIT and unsigned executable memory — without them a signed build launches
to a blank window). Then `npm run notarize` zips with `ditto`, submits, waits,
staples and verifies with `spctl`. Store credentials once:

```sh
xcrun notarytool store-credentials "pigment" \
  --apple-id you@example.com --team-id TEAMID --password <app-specific-password>
```

## What is left

M4: onboarding, a config surface, the full image set, and the colour silhouette
tray icon.

A native Swift/AppKit rewrite is parked, not rejected — see SPEC §13 for the
measurements and why the cost is inverted from what you would guess.

## Privacy

Pigment opens your transcripts, because token counts live inside them. It reads
`timestamp` and `usage` from assistant records and nothing else — not `cwd`,
not `gitBranch`, not a byte of message content — and it never sends anything
anywhere. `src/core/parse.ts` is where that rule is enforced, and a test asserts
the fields cannot survive the boundary.

macOS-oriented, but M1 is plain Node and runs anywhere.
