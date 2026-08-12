# Pigment — Specification

A macOS menu-bar app. Each day gives you one grayscale pixel-art image. It
colorizes as you burn AI tokens. Past days stay on a wall, each frozen at
however filled it got.

> The image is a mirror with a sharp tongue. It does not reward you for burning
> and it does not scold you for resting. It shows you the shape of your month.

Fourteen settled decisions, each with the reasoning that produced it and the
cost it accepts. An appendix records what was rejected. This document is the
contract; disagreement with it is a change to it, not a change in the code.

Every number below was derived from a real 33-day sample of
`~/.claude/projects` (179 files, 267 MB, 29 active days), not invented.

---

## §0 The measured ground

All design constants trace to these observations. When they stop being true,
the constants are wrong and this section is where you come back to.

| Observation | Value |
| --- | --- |
| Output tokens/day | min 12k · p25 66k · **median 192k** · p75 264k · max 845k |
| Spread (p90/p10) | **15.5×** for output tokens; 47.7× for raw tokens; 32.4× for cost |
| Active vs idle days | 29 active, 4 idle across 33 calendar days |
| Idle days by weekday | **all 4 were Mon–Thu.** Zero idle Fri/Sat/Sun |
| Heaviest weekdays | Sun 322k · Fri 224k · Sat 192k (medians) |
| Lightest weekdays | Tue 62k · Thu 99k · Wed 114k |
| Peak output hour | **23:00** (657k/month), then 22:00 (637k), then 21:00 (556k) |
| Share in 22:00–02:00 | **27%** |
| Share in 03:00–07:00 | **0%** — a clean natural seam |
| Fastest day to median | 1.9h (Aug 3). Days completing within 1h of first activity: **0** |
| Peak rolling hour | median 73k · max 165k |
| Estimated cost/day (Opus 5 rates) | p10 $4.49 · **median $38.92** · p90 $145.64 · max $295.14 · 29-day total $1,737 |
| Full corpus parse | 0.54s |
| Files touched in last 24h | 13 (26 MB) |
| Files appended >24h after creation | **39 of 179** — resumed sessions are normal |

Two facts do the most work downstream. **Output token rate has a physical
ceiling** (model throughput × session parallelism), so the fill cannot be
gamed by wanting it more — only by actually running more work. And **the user
is a night worker**, which invalidates every calendar convention built for
people who work 09:00–17:00 on weekdays.

---

## §1 What filling means

**Burning tokens fills the image. The image is a mirror, not a score.**

The alternative — filling on *restraint*, so the image completes when you stay
under budget — was rejected because it renders your most productive day as your
ugliest square. Aug 3 (845k tokens) was real work; an app that paints it as
failure gets deleted in a week.

But straight burn-as-reward is a slot machine. The mitigation is §3: difficulty
tracks your own recent baseline, so "full" means *a day heavier than your
median*, not *a lot of tokens*. The bar moves with you. Burning more this month
does not make images easier next month; it makes them harder.

**Accepted cost.** A mirror has weaker pull than a game. §7 exists to supply
what the mirror cannot.

## §2 The unit of burn

**Output tokens fill the image. Estimated cost appears only in roast copy.**

Output tokens win on every structural axis: the tightest usable dynamic range
(15.5× vs 47.7× for raw tokens), independence from pricing tables Anthropic
changes, independence from which plan a given user is on, and a physical rate
ceiling that makes the signal honest by construction.

Raw tokens and cost are both dominated by `cache_read_input_tokens` — one day
logged 356M cache reads against 845k output. That measures *how large your
contexts were*, not how much work happened, which is why it blows out to 48×.

Cost is still computed, because it is where the sharp line lives — *"You
finished the fox at 10:35. That is $30 of Opus before lunch"* is better copy
than any token count. It never appears on the wall, only in roast text, because
the wall is the surface a coworker reads over your shoulder.

**Opus 5 rates**, per million tokens — the table the cost estimate uses:

| | Rate | Note |
| --- | --- | --- |
| Input | $5.00 | |
| Output | $25.00 | |
| Cache write, 5m TTL | $6.25 | 1.25× input |
| Cache write, 1h TTL | $10.00 | 2× input |
| Cache read | $0.50 | 0.1× input |

The logs report `cache_creation.ephemeral_5m_input_tokens` and
`ephemeral_1h_input_tokens` separately, so the two write tiers are priced
correctly rather than lumped. Keep this table in one module and treat it as
data — Anthropic changes prices, and a wrong constant here is a wrong joke, not
a crash.

**Accepted cost.** Cost figures are computed at API list rates. On a
subscription the real number is a flat fee, so the roast is technically
fiction. It is funny anyway.

## §3 The difficulty controller

**A Frugal-1U quantile tracker in log space. One float of state.**

```
if today > target:  target *= exp(+k·q)         // beat it → harder
else:               target *= exp(−k·(1−q))     // missed  → easier
```

- **q = 0.4** — the target converges to your 40th percentile day, so ~60% of
  active days complete.
- **k = 0.15** — step size. Roughly a three-week time constant.
- **Clamps** — target ∈ [30k, 600k]; per-day change capped at ±15%.
- **Update once per day**, at seal (§9), using the sealed total.

Setting `q` *is* setting the completion rate; there is no separate difficulty
parameter. Swept against real history (`npm run sweep`), q=0.4/k=0.15 completes
**18 of 29** active days (62%), and 67% across the back half of the window once
the tracker has converged. The sweep confirms `q` alone drives the rate:
q=0.30 → 72%, q=0.35 → 66%, q=0.40 → 62%, q=0.45 → 55%, q=0.50 → 52%.

There is no smoothing window and no stored array of past days. The memory is
exponential and the half-life is `k`. This is the entire adaptive loop.

**Why k = 0.15 and not 0.30.** At k=0.30 a three-day slump cuts the target 25%,
which reads as the app going soft the moment you struggle. At k=0.15 a single
monster day raises tomorrow ~6%. The loop should be a slow tide, not a
thermostat.

**Speed is not a controller input.** "Completed too fast → harder tomorrow" is
already covered: a fast completion is a high-volume day and the target rises
accordingly. A separate speed term would be a second controller fighting the
first for one actuator. Rate is roast material only (§7).

**Validated behaviour.** Replaying real history: the Jul 23–31 slump walked the
target from 188k down to 89k, so Jul 31 (a weak 70k day) still rendered at 79%.
Aug 1–8 walked it back up. A bad week does not produce a wall of gray; a good
week does not produce free wins.

## §4 Days, boundaries, and absence

**A Pigment day runs 04:00 → 03:59 local. The boundary is configurable.**

Midnight is actively wrong for this user: 27% of output lands between 22:00 and
02:00, so a midnight boundary would split the single most productive block
across two images *every night*. 03:00–07:00 is exactly zero in the sample.
04:00 is the seam.

Configurable because the same person runs a company laptop on a different
rhythm.

**No weekend logic of any kind.** Weekends are the heaviest days here (Sun 322k
median). Every "rest day" convention is backwards.

**Idle = under 2,000 output tokens.** The lightest real working day was 11.8k,
so 2k cleanly separates "worked a little" from "did not work."

**An idle day does not update the controller.** Absence is not evidence about
capacity; it is absence of evidence. The target freezes.

**Short gaps show, long gaps collapse** — superseded, see below. 1–2 idle days
each get a gray square; that is real information, you were around and did not
work. **3+ consecutive idle days collapse into one strip** reading `away · 9
days`. Fourteen gray tombstones is not information, it is the app shouting, and
with §7 attached it becomes actively unpleasant.

**Amendment: the calendar supersedes the collapse.** The strip was the answer to
long gaps in a *flow* layout, where a run of grey squares carries no information
except its own length. Once the wall is weekday-aligned (§6a), position encodes
the date and a fortnight away simply *is* two rows of pale cells in the right
place — legible at a glance, and honest in a way a summarised strip is not. The
collapsing code and its test were removed rather than left unused.

**No re-entry grace.** Coming back rusty produces genuine misses, the controller
walks the target down ~9% each, and after four days it is 35% easier. That is
the loop working honestly, and it beats a special case tuned blind.

**Accepted cost.** Your first day back from holiday is probably a gray square,
exactly when a win would be welcome.

## §5 Where images come from

**v1: 12 hand-drawn images across 3 complexity tiers. Scaling later.**

| Tier | Fires when today's target is | Canvas | Colors |
| --- | --- | --- | --- |
| 1 | below 0.92× the trailing baseline | 16×16 | ~6 |
| 2 | between 0.92× and 1.10× | 32×32 | ~10 |
| 3 | above 1.10× it | 48×48 | ~16 |

The baseline is the **median of the last 21 days' targets** — median, not mean,
so one spike week cannot drag it up and quietly re-label a normal day as tier 1.

**Amendment, forced by M1's replay.** The bands were originally absolute token
counts (<90k, 90k–200k, >200k). Replaying the measured history showed the
controller's entire operating range was **102k–192k**, so every single day for
sixty days landed in tier 2 and the tier signal never fired once — the whole
mechanism was dead on arrival. Absolute bands only work if you already know the
user's scale, which is exactly what the controller exists to learn. Relative
bands are self-calibrating, work unchanged for a coworker running a tenth of
your volume, and cannot silently degrade into a constant. After the change the
same history produced 12 tier-1 days, 18 tier-2 and 3 tier-3 at the first band
width (±13%) — tier 3 firing on 9% of days is still nearly invisible, so the
bands were narrowed to −8%/+10%, giving **15 / 11 / 7**.

The sweep also showed `k = 0.20` would fix the mix on its own. It was not used:
`k` answers to the completion rate, the bands answer to whether you can see the
tier change, and distorting the control loop to improve a readout is the wrong
lever. Related: at `k ≤ 0.05` the target moves ~2%/day and never leaves its own
trailing band, so tier 3 fires **zero** times — `k` has a floor imposed by the
display, which is a coupling worth remembering before anyone smooths the loop.

**Complexity is not difficulty.** Fill = tokens ÷ target; the target alone sets
how hard a day is. Adding pixels changes only how finely the fill is chopped.
Tiers exist for exactly one reason: **to make the controller's state visible.**
After a heavy week the picture is visibly busier, and the raised bar announces
itself through the art instead of hiding in a float.

Three tiers, not five: with 12 drawings, five tiers gives 2–3 each — repeats
every ~10 days and a difference between tier 3 and 4 nobody can see. Three
tiers gives four drawings each and unmistakable jumps.

**Image choice is `hash(date)` over the tier pool** — deterministic, so
recomputing a day (§9) yields the same image rather than a different one each
launch.

**Amendment: art can now be imported, not only authored.** `npm run import`
turns a PNG into a `Drawing`. It recovers the artist's grid rather than
downsampling — the first import was a 64×64 picture saved at 1216×1216, and
averaging that to 48×48 would have destroyed the thing that makes it pixel art.
Imported drawings keep their native grid; tiers stop dictating canvas size for
them, which is harmless because the popover already draws every day at the same
on-screen square. Tier then means *detail*, which is what it always meant.

Two fields the importer guesses and a human must check: the fill `order` and
which entries are `background`. Neither can be inferred — they are authorial
(§6, §11). It guesses "colours touching the border are scenery, subject first by
area" and prints the palette so you can correct it.

**Amendment: a deck, not a hash.** Image choice was `hash(date) % pool`, which is
uniform over two years to within 1% — and clusters badly in the short run. A
real ten-day stretch put the same picture on four days, three consecutive.
Choice is now a per-cycle shuffled deck: every picture is dealt once before any
repeats, and the deal is adjusted so a cycle never opens on the card the last one
closed with. The shortest possible gap between two showings is now 2 days
instead of 1, and the long-run distribution is exactly even.

**Scaling path (M4, not now):** batch-generate candidates with an image model,
hand-curate, ship as static assets. Runtime stays fully local. Evaluated
`Synero/pixel-art-studio` and deferred it — it downscales-and-quantizes rather
than composing, produces no alpha, no indexed output, and no fill ordering, and
its generated images carry Pollinations' terms rather than the repo's.

## §6 How color spreads

**Palette order for structure, bottom-up within each color for smoothness.**

Pixel art is indexed color. Each image ships an authored ordering of its ~8–16
palette entries: **subject first, background last.** At 40% you have a fully
colored fox on a gray field, which reads as a finished illustration in a style.
Background-first at 40% gives a gray fox in a colored world, which reads as
broken.

Within each palette entry, its pixels fill bottom-up, so progress is continuous
to the pixel instead of jumping 8% at a time.

**Weight bands by pixel count, not equally.** If sky is 60% of pixels and an eye
is 4 pixels, equal weighting stalls the fill visibly on the sky and blinks
through the eye.

The picture is never *missing* — it is grayscale from the first moment, full
composition and full detail, just desaturated. So a partial image always reads;
the only question is whether the pattern of color looks deliberate. Authored
palette order guarantees it does.

**Authoring cost:** one ordered list of ~12 integers per image, plus a short
list of which entries are scenery (§11 needs it for the tray silhouette).

**Authoring constraint, found in M2:** a feature thinner than one pixel at the
tier's canvas samples to nothing and its colour vanishes from the image
entirely. At 16px that floor is 1/16 of the unit square. A test asserts every
declared colour is actually visible, because the failure is silent otherwise —
it caught a leaf vein and a moon hidden under a lighthouse beam.

## §6a The wall is a calendar

**Seven columns, Monday first, one row per week, newest week at the top.**

The first wall was a flow of tiles in reading order. It looked fine and told you
nothing: there was no way to answer *"how was last Tuesday?"* without hovering
over squares one at a time, because the only dates were in tooltips.

Weekday alignment costs tile size — seven columns in a 420px popover means ~48px
per day instead of ~96 — and buys the thing §0 measured and the old layout hid:
**a weekly rhythm**. Sundays are this user's heaviest day (322k median) and
Tuesdays their lightest (62k); every idle day in the sample fell Mon–Thu. In a
column layout that is a bright column and a pale one. In a flow layout it is
invisible.

Newest week at the top, rather than a calendar's usual top-to-bottom order, so
today is always on the first row and never behind a scroll. Today's picture
stays large above the grid — it is the thing you actually came to look at, and
it is the one place tile size still matters.

## §7 Overshoot, and the personality

**Past 100%, the image overexposes. One continuous curve, capped at 4×.**

Aug 3 hit **8.7× target**. Under a cap-at-full rule it renders identically to a
1.02× day — the most extreme day of the month, indistinguishable from a mild
one. Saturation and bloom climb past natural; at the extreme the image is
blown out, white-hot, too much.

This is a wordless roast. Burning 8× does not earn a trophy, it overexposes the
picture. It is continuous, so there is no threshold to game, and it makes the
wall worth scanning: gray → colored → glowing → bleached.

**Accepted cost.** Your biggest days look damaged. Aug 3 was probably valuable
work and renders as a bleached square. This is the honest consequence of
choosing a sharp tone over a celebratory one.

**Roasts fire on rate, not volume.** Trigger on peak-hour output crossing your
own p90 (~130k/h). Rate is the genuinely surprising quantity and cannot be
reached by grinding all day. Note that "finished in one hour" — the obvious
trigger — has happened **zero times in 29 days** and is physically unreachable;
do not build it.

**One event system, several conditions:** an all-time first, p90 peak-hour rate,
a comeback after 3+ days away, a late session, a dead day — plus **an overshoot
past 2×**, added during M3. **6 conditions × 4 quips**, with a "not seen in 30
days" filter. Six quips on one condition is dead content in a fortnight.

**An all-time first is the biggest day or the fastest hour, whichever falls.**
No milestone to cross: a round number like 500k or $100 is arbitrary and stops
meaning anything when your volume changes. Beating your own record calibrates
itself, exactly as the controller and the rate trigger do, and stays rare
however much the work shifts. It needs 8 prior active days before it counts —
otherwise day two is an all-time best and so is day three.

**Only three of the six may interrupt**, and that split is the design. Measured
over 34 real days: `blown` fires on **30% of active days** — noise rather than
surprise, and already said in paint by the bloom and the tray ring. `dead` would
be the app poking you for not working, which contradicts §1 directly. Both
produce a line in the popover, where you went looking for it, and neither may
raise a notification. That leaves first, rate, comeback and late: **7
notifications across the measured month, about 1.4 a week.**

**Thresholds look only at days before the one being judged.** Including today
would let a record hour raise the bar it is measured against — the same
self-reference that once pinned the cold-start day at exactly 100% (§10).

**Quip history is derived by replaying the wall, not read from what was
delivered.** Storing only deliveries leaves every popover-only line outside the
cooldown, and the measured month duplicated a dead-day line inside eight days.
When a pool is exhausted the *stalest* line is reused rather than a re-hashed
one, which could otherwise land on yesterday's.

**Delivery: macOS notification, hard-capped at one per day, default on.** On
real history that fires about twice a week — rare enough to still surprise, far
too rare to be noise. A roast nobody reads is dead content, and popover-only
means most are never read. The toggle is the **first item in the tray menu**, so
the escape hatch is obvious the moment it annoys someone.

**Notifications need a BUNDLE, not a certificate.** Run unpackaged, every send
fails with `UNErrorDomain error 1`: `npx electron .` is the generic Electron
binary and macOS will not grant notification rights to something with no bundle
identity. Packaging fixes it — an **ad-hoc signed** `out/Pigment.app` prompts
for permission and delivers normally. Developer ID signing is required only to
hand the app to someone else, not to make the roast layer work for yourself.
This was worth establishing before paying for anything: the two are separable,
and only one of them is free.

Post through the normal notification API and do not fight Focus/Do Not Disturb.
Consider suppressing entirely while screen recording is active — *"$30 of Opus
before lunch"* appearing mid-demo is a very fast uninstall.

## §8 Ingestion

**Byte cursor per file. `stat` on the fast cadence, read only past the cursor.**

Forced by measurement: 267 MB total, 26 MB touched in the last day, 0.54s for a
full parse. Cheap once, ruinous on a 5-second poll. Steady state with cursors is
a few KB per tick.

Non-negotiable details, each corresponding to an observed condition:

- **Hold back a trailing partial line** until the next read — Claude Code may be
  mid-write.
- **Reset the cursor to 0 if a file shrinks** — truncation or rotation.
- **Dedup on `message.id`** — duplicate records appear across files in every
  query run against this corpus. Without dedup, totals inflate.
- **Attribute by `timestamp`, never by file mtime** — 39 of 179 files were
  appended more than 24h after creation. A resumed session writes messages
  stamped for a day that has already closed.
- **Extract only `timestamp` and `usage`. Never retain a byte of content.**

That last rule deserves emphasis. Tenant enforces the equivalent
*structurally* — `scanner.ts` never opens a file, and its header reads "METADATA
ONLY … the creature senses THAT you think, never WHAT." Pigment cannot do this;
token counts live inside the files. So the guarantee degrades from an
architectural property to a code-review discipline, which is strictly weaker.
It is written here so that weakening is a decision on the record rather than an
accident. **Nothing is ever sent anywhere.**

## §9 Truth, storage, and time

**Recompute the last 48 hours from logs. Seal everything older into our own
store and never recompute it.**

Each of the three alternatives fails a real case:

- *Always recompute* dies when Claude Code rotates old logs — your wall would
  be only as durable as someone else's cache directory.
- *Seal at the boundary and never look back* dies because the Mac is asleep at
  04:00 most nights, so the seal often will not fire; and because a session
  resumed the next morning writes messages stamped yesterday.
- *48-hour window* survives both. Asleep at the boundary → next launch
  recomputes and seals correctly, no missed-cron bug. Session resumed with
  yesterday's timestamps → still inside the window, so yesterday's fox gets the
  color it earned. Logs rotated → those days sealed weeks ago.

**Sealed records store the controller state alongside the day**, so history can
be replayed and audited rather than depending on one opaque float you can never
explain.

**Accepted cost.** Two sources of truth with a seam between them, and seam bugs
are the annoying kind. Mitigated by the replay script (§11), which recomputes
full history offline and diffs against the sealed store — the regression test
for the entire system, in about 40 lines.

Reuse from Tenant, verbatim where possible: atomic write via tmp + fsync +
rename (`persist.ts:133`), refusal to read a future schema version (`:75`),
quarantining an unreadable file instead of crashing (`:215`).

## §10 First launch

**Backfill the wall from history, capped at 60 days.**

The cold-start argument decides it alone. Without backfill, a new user's first
week is meaningless — the target starts at an arbitrary seed and takes ~3 weeks
to converge, so early images are either trivially full or hopelessly gray. That
is precisely the window in which someone decides whether to keep the app. With
backfill, day one is already calibrated to them.

It is also the difference, when showing a coworker, between "here's an idea" and
"here's your last two months." A full parse costs 0.54s.

**Today never seeds itself** — amendment, forced by M1's composition tests. The
cold-start seed is drawn from *finished* days only. Including the live day makes
the seed track the very number it is meant to judge: the target equals today's
output, and the first day is pinned at exactly 100% no matter what happens. With
a single day of history that is the difference between a meaningless first
square and an honest one.

**Seed at the qth quantile, not the median** — amendment, forced by M1's replay.
The tracker's fixed point *is* the qth quantile, so seeding there starts the
wall already at rest. Seeding at the median starts it above the fixed point and
spends the first fortnight walking down, marking real working days as misses on
the way: on the measured history a median seed completed **52%** of active days
across the window, against the intended 60%, and only reached the right rate
once it had converged. The quantile seed produced **62%**.

Reconstructed days are **not** visually marked as second-class. They are built
from the same data by the same code as live days. Dimming them would be
apologizing for the best feature.

**Accepted cost.** A first launch that thinks for a second, and a wall whose
early days were never watched filling.

## §11 The menu bar

**v1: a macOS template image. Fill encoded in alpha.**

A template image is monochrome by definition — alpha carries the shape, RGB is
forced black, the system tints for light and dark. Native behaviour for free.
The cost is real and knowingly paid: **an app about color shows no color in the
menu bar in v1.**

Consequence: overexposure (§7) cannot be signalled by color. Past 100% the
shape gains a ring outside its outline.

**Amendment, forced by M2.** The vessel needs a *shape*, and eight of the twelve
drawings are scenes — sky to one edge, ground to the other. Their silhouette is
the whole canvas, so the icon rendered as a filled square: no shape to
recognise, and no outside for the overexposure ring to occupy. Each drawing now
declares which palette entries are **scenery**, and the icon uses only the
subject. The fox reads as a fox at 16 points; the sky is simply not part of it.

The icon also fills the subject **bottom-up by the day's overall fill**, rather
than replaying the palette order the picture uses. The popover answers *which
thing gained colour*; the tray answers the cruder question *how far along am I*,
and a rising water line answers that legibly at 16 points where palette order
would just flicker.

**Phase 2 — silhouette as vessel.** Today's image reduced to its outline shape,
filling bottom-up in the day's dominant color. This makes the menu bar and the
popover the same object: you glance up, see a half-colored fox, and know both
how far along you are and which day it is. Requires `setTemplateImage(false)`
and handling light/dark manually. Three rules when that lands:

- Draw at 32×32 and let macOS downscale, or the silhouette breaks up.
- Outline every icon with a 1px contrasting ring — non-template color icons
  vanish against half the wallpapers in the world, and this ships to coworkers
  with unknown setups.
- Distinguish extreme states by **shape**, not only color. Overexposed blooms
  past the outline; no-data is a hollow outline. Roughly 8% of male viewers will
  not distinguish some palettes at all.

**No animation. Redraw only when fill crosses a 2% step** — about 50 redraws on
a working day, invisible cost, still noticeable when you glance up. A creeping
fill is delightful for a week and an attention tax forever.

Tenant's `scripts/gen-tray-icon.mjs` contains a hand-rolled PNG writer with zero
image dependencies. Reuse it and feed `nativeImage.createFromBuffer`.

## §12 Milestones

**M1 — Core, headless.** Tail + cursors + dedup, day bucketing at the
configurable boundary, the controller, the seal store, backfill, and a `replay`
CLI that prints 60 days of wall as ASCII. **Zero Electron.**

This is the real weekend, and it is deliberately first. Every hard problem lives
here and every one is testable without a pixel. More importantly, `q` and `k`
cannot be tuned by *using* the app — that is three weeks per experiment. They
are tuned by replaying 60 days in half a second. Tenant's `replay.ts` says why:
*"the only way to find out whether a three-day breach threshold and a 1.5-day
tau are right for YOUR life without waiting three months to be told the hard
way."*

**M2 — It lives.** Tray with template icon and alpha fill, popover with today's
image and the wall, 12 images across 3 tiers, palette-order + bottom-up fill.
Borrow Tenant's tray, persist, and PNG writer.

**M3 — Sharp.** Event detector, quip pool, capped notification, overexposure
rendering, hover multiplier and cost. Last on purpose: it is the part you will
iterate on weekly and it needs real days to react to.

**M4 — Shippable.** Developer ID signing and notarization, onboarding, config
surface, the 60-image set, the color silhouette icon. Only if you still want it
after a month of living with M2.

Status: packaging, notarization tooling, onboarding and the config surface are
done. Signing awaits a certificate; the image set and the colour icon remain.
**The update path was dropped** — Sparkle or electron-updater is a large
dependency for an app with one user and no release cadence. Rebuilding is the
update path until there is a second user.

The config file is *written*, not merely read. A settings file that only exists
once you create it is a settings file nobody knows about, and every knob here —
the boundary, q, k — was real, tested and documented while being discoverable
only by reading the source. It carries `//` comments, stripped on read, because
`"q": 0.4` is meaningless without the sentence saying q is the completion rate —
and it is named `.jsonc`, because a `.json` file full of comments is one every
editor and every other tool reports as invalid.

Note on M4: Tenant's `scripts/package.mjs:9` states plainly that it is ad-hoc
signed and "fine for running your own build, not for handing to anyone else."
Handing this to coworkers means an Apple Developer account, Developer ID
signing, notarization, stapling, and an update path — a weekend by itself, and
only *after* the app works.

## §13 Deferred, deliberately

Each of these is a decision **not to decide yet**, not an oversight.

- **Internet meme fetching.** Breaks local-only, adds a network threat model, an
  offline story, and licensing questions. Ship a bundled quip pool; add a
  fetcher behind a flag if the app survives.
- **Multi-machine merging.** Two laptops means two `~/.claude` directories, two
  walls, two controllers each calibrated to half your work — neither wall is
  true. Merging needs sync, which needs network, which is a different app.
  **Each machine gets its own honest wall.** This is a choice, not a gap.
- **Procedural / modular image generation.** The most interesting engineering
  here and the most likely to eat the whole project.
- **`Synero/pixel-art-studio`.** Re-evaluate at M4; see §5.
- **The color silhouette tray icon.** §11 phase 2.
- **A native Swift/AppKit rewrite.** Wanted, and parked deliberately. Measured
  at the end of M4, on the packaged build:

  | | |
  | --- | --- |
  | Bundle | **275 MB**, of which our code is **72 KB** — Electron is 99.97% |
  | Memory | **182 MB** across 3 processes, idle |
  | CPU | 0.0% idle |
  | A native equivalent would be | roughly 5 MB and 30 MB |

  The cost is inverted from intuition. Only **two files** in `src/` import
  Electron and only **three lines** mention it — the shell is 784 lines. What a
  rewrite actually costs is the other **3,364 lines of pure TypeScript** plus
  **1,599 lines of tests**, none of which is Electron-shaped: the controller,
  the deck, the fill, the seal seam, the importer. You would spend a week
  reproducing behaviour that already works and end up with an app that does
  exactly what this one does, 50× smaller.

  **That trade is only worth it for the learning**, which is the stated reason —
  so when it happens it should be scoped as *a Swift project that reimplements
  Pigment*, not as *porting Pigment*. Those have different definitions of done,
  and pretending otherwise is how a rewrite stalls at 80%.

  If the motivation ever shifts to distribution size instead, the cheaper answer
  is a DMG (Electron compresses to roughly 90 MB) or Tauri (~10–15 MB, Rust
  backend, system WebKit — the renderer survives, the core does not).

## §14 The thing this app must not become

It must not make you burn tokens you did not need to burn.

The defences are structural rather than stated: output-token rate is physically
capped, so there is no way to spend your way to a full image faster than you can
actually work. The target tracks *your own* median, so a heavy month makes next
month harder rather than easier. Overshoot is rendered as damage, not as a
trophy. And nothing in the app is a streak.

If you ever catch yourself running a pointless agent at 23:50 to finish a fox,
the app has failed and this section is the one it failed.

---

## Appendix — rejected, with reasons

| Rejected | Why |
| --- | --- |
| **Restraint fills the image** | Renders your most productive day as your ugliest square. Aug 3 was real work. |
| **Cost or raw tokens as the fill metric** | 30–48× spread, dominated by cache reads. Measures context size, not effort. Also depends on a pricing table and a subscription plan. |
| **A trailing-window average as the controller** | Requires storing history and picking a window length. The quantile tracker is one float and its window *is* `k`. |
| **Speed as a second controller input** | Two controllers fighting for one actuator. Volume already encodes speed. |
| **"Completed within 1 hour" as the roast trigger** | Has happened 0 times in 29 days. Physically unreachable — peak rolling hour is 165k. |
| **Trophy tiers (bronze/silver/gold) for overshoot** | A reward for burning. Pulls the app back toward a slot machine and cannot coexist with a sharp tone. |
| **Banking overflow into tomorrow** | A rest day after a big day fills itself, and the wall stops being a record of days. |
| **Skipping idle days on the wall** | Three months would look like an unbroken streak. The wall would lie. |
| **Tombstoning every idle day** | Fourteen gray squares for a holiday. Not information — just the app shouting. |
| **Weekend special-casing** | Weekends are the heaviest days here. Every such rule is backwards. |
| **Midnight day boundary** | Splits the 22:00–02:00 block — 27% of all output — across two images every night. |
| **Random-dither fill order** | Smoothest possible progress. Looks like screen damage. |
| **Water-line fill alone** | A progress bar wearing a picture. Every day becomes the same mechanic. |
| **Radial fill** | The bloom cuts across objects. Half a fox's face colored is worse than none of it. |
| **Full-size image in the menu bar** | A 48×48 tier-3 image at 16px is a colored smudge. |
| **Uncapped notifications** | Would have fired most days in early August and been muted by week two. |
| **Marking backfilled days as second-class** | The reconstruction is accurate. Dimming it apologizes for the best feature. |
| **Five complexity tiers in v1** | 12 images ÷ 5 tiers = repeats every 10 days and invisible differences between adjacent tiers. |
| **Starting with a procedural generator** | Commits to a parts pipeline before knowing whether 40%-filled reads as a picture. |
