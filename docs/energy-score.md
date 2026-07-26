# Buzz — the caffeine energy score (spec)

> Written from fetched sources, not recall (AGENTS.md guardrail). The links at
> the bottom are the ones the constants come from. Re-fetch them before changing
> any number here.

**Buzz** is a 0–100% battery reading of how much caffeine is currently active in
a user's body. It is **derived, never stored**: a pure function of that user's
`coffee_entries` rows evaluated at request time. No score, level or series is
ever written down — deleting or backdating a coffee immediately and correctly
changes the whole curve. The only stored thing is one *model parameter*, the
user's personal half-life (see below); the score itself stays derived.

- Model + math: `server/src/energy.js` (pure, unit-tested in `energy.test.js`)
- Endpoint: `server/src/routes/energy.js` → `GET /api/energy?hours=24`
- Widget: `client/src/components/BuzzWidget.tsx`, shown on the Profile page

## The model

One-compartment pharmacokinetics with first-order absorption (the Bateman
function). For a single dose `D` taken `t` hours ago:

```
active(t) = D · (ka / (ka − ke)) · (e^(−ke·t) − e^(−ka·t))
```

| Constant | Value | Where it comes from |
| --- | --- | --- |
| `ke` | `ln2 / halfLifeH` | **Per-user** (see below). Default 5 h — the healthy-adult mean. |
| `ka` | `ln100 / 0.75 h` | ~99% of an oral dose is absorbed within 45 min. Fixed for everyone. |
| `FULL_MG` | 200 mg | EFSA: single doses up to 200 mg raise no safety concern for adults — the natural "full battery". |

Consequences that fall out of those constants (not tuned by hand):

- Peak at **~38 min** after drinking, at **~92%** of the dose. This is the
  "charging takes time" behaviour the widget is built around — a coffee does not
  fill the battery instantly, exactly like a laptop charger.
- Doses **stack additively** — several coffees sum into one curve.
- A dose is irrelevant after `DOSE_LIFETIME_H` (72 h), which is how far back the
  endpoint loads entries beyond the requested window so the left edge of the
  chart shows real residual level, not a false zero.

## The half-life is per-user

Elimination half-life is the one parameter with real inter-individual spread:
roughly **2–3 h in fast CYP1A2 metabolizers vs 9–12 h in slow ones**, published
range 1.5–9.5 h. Smoking roughly halves it; hormonal contraceptives roughly
double it. Absorption (`ka`) is gastric emptying rather than enzyme activity, so
it stays fixed.

Stored as `users.caffeine_half_life_h` (REAL, **nullable**). NULL means the user
never set one and is resolved to `DEFAULT_HALF_LIFE_H` at read time — the default
is deliberately *not* written into the column, so changing it later still reaches
everyone who never chose a value.

`clampHalfLife()` coerces anything unusable (NULL, a string, NaN, a typo) into
the 1.5–9.5 h range rather than erroring, so a bad value can never draw a
nonsense curve. `PATCH /api/auth/me` accepts a number or `null` (reset); only a
non-numeric value is a 400.

We collect **no health data** for this. The user picks a felt class (Fast 3.5 h /
Normal 5 h / Slow 7 h) or types their own number if they know it. Smoking status,
contraceptive use and genotype are never asked for or stored — only the resulting
hours. Keep it that way: those are special-category data and the accuracy gain
does not justify holding them.

Both horizons are sized for the **slowest** metabolizer, not the average:
`DOSE_LIFETIME_H` = 72 h is 7.5 half-lives at 9.5 h (36 h would have been under 4
and would truncate real caffeine off a slow user's chart), and `FORECAST_MAX_H`
= 72 h because a full 200 mg battery at 9.5 h needs ~63 h to fall under 1%.

Level is `min(100, round(active_mg / FULL_MG × 100))` — capped, like a real
battery indicator. `active_mg` is returned uncapped alongside it.

## Time domain

**Instant domain only** (see [time-and-timezones.md](./time-and-timezones.md)).
Every input and output is UTC epoch milliseconds; elapsed time is `now − then`,
a duration. `server/src/energy.js` must never import `../time` — there is no
civil-day logic here and therefore no timezone. The client formats axis labels
in the browser's own zone, same as feed post ages.

Doses at or after the evaluation instant contribute nothing, which keeps the
curve consistent with the no-future-events rule.

## Endpoint contract

`GET /api/energy?hours=<1..168>` (default 24), JWT auth. Returns:

```jsonc
{
  "level": 63,             // 0-100, capped
  "active_mg": 126.4,
  "full_mg": 200,
  "state": "charging",     // charging | draining | empty
  "half_life_h": 5,        // the value the curve was actually drawn with
  "window_hours": 24,
  "step_ms": 300000,
  "now": 1770000000000,
  "peak": { "t": …, "level": 88, "active_mg": 176.2 },
  "empty_at": 1770020000000, // instant level first drops below 1%, or null
  "series": [{ "t": …, "level": …, "active_mg": … }],
  "doses":  [{ "id": …, "coffee_id": …, "caffeine_mg": …, "logged_at": … }]
}
```

`state` is the slope at `now` (read one minute ahead), so a coffee still being
absorbed reads as *charging*. `series` is capped at `MAX_POINTS` (288) samples —
5-minute resolution at 24 h, coarsening for longer windows — so both the payload
and the SVG path stay bounded.

`empty_at` is `null` when the battery is already flat or stays above 1% past the
72 h forecast horizon.

## Sources (fetch before changing constants)

- Alsabri et al., *Kinetic and Dynamic Description of Caffeine* (J. Caffeine
  Adenosine Res., 2018): https://journals.sagepub.com/doi/10.1089/caff.2017.0011
- ISSN/JISSN, *Common questions and misconceptions about caffeine
  supplementation* (2024): https://www.tandfonline.com/doi/full/10.1080/15502783.2024.2323919
- EFSA, *Scientific Opinion on the safety of caffeine* (EFSA Journal
  2015;13(5):4102): https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2015.4102
- *Genetic susceptibility to caffeine intake and metabolism: a systematic
  review* (2024) — the CYP1A2 fast/slow spread:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11515775/
- Tian et al., *Effects of Common CYP1A2 Genotypes on the Caffeine Metabolic
  Ratio* (Clin. Transl. Sci., 2019):
  https://ascpt.onlinelibrary.wiley.com/doi/10.1111/cts.12598
- Coffee & Health, *Caffeine and metabolism* — smoking, contraceptives and other
  modifiers: https://www.coffeeandhealth.org/health/coffee-and-caffeine/caffeine-and-metabolism
