# Buzz — the caffeine energy score (spec)

> Written from fetched sources, not recall (AGENTS.md guardrail). The links at
> the bottom are the ones the constants come from. Re-fetch them before changing
> any number here.

**Buzz** is a 0–100% battery reading of how much caffeine is currently active in
a user's body. It is **derived, never stored**: a pure function of that user's
`coffee_entries` rows evaluated at request time. There is no table, no column,
and no migration for it — deleting or backdating a coffee immediately and
correctly changes the whole curve.

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
| `ke` | `ln2 / 5 h` | Caffeine plasma half-life is ~5 h in healthy adults (range 1.5–9.5 h). |
| `ka` | `ln100 / 0.75 h` | ~99% of an oral dose is absorbed within 45 min. |
| `FULL_MG` | 200 mg | EFSA: single doses up to 200 mg raise no safety concern for adults — the natural "full battery". |

Consequences that fall out of those two constants (not tuned by hand):

- Peak at **~38 min** after drinking, at **~92%** of the dose. This is the
  "charging takes time" behaviour the widget is built around — a coffee does not
  fill the battery instantly, exactly like a laptop charger.
- Doses **stack additively** — several coffees sum into one curve.
- A dose is irrelevant after ~36 h (`DOSE_LIFETIME_H`, >7 half-lives), which is
  how far back the endpoint loads entries beyond the requested window so the
  left edge of the chart shows real residual level, not a false zero.

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
  "half_life_h": 5,
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
48 h forecast horizon.

## Sources (fetch before changing constants)

- Alsabri et al., *Kinetic and Dynamic Description of Caffeine* (J. Caffeine
  Adenosine Res., 2018): https://journals.sagepub.com/doi/10.1089/caff.2017.0011
- ISSN/JISSN, *Common questions and misconceptions about caffeine
  supplementation* (2024): https://www.tandfonline.com/doi/full/10.1080/15502783.2024.2323919
- EFSA, *Scientific Opinion on the safety of caffeine* (EFSA Journal
  2015;13(5):4102): https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2015.4102
