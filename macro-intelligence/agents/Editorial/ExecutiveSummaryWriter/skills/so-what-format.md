# The "So What" Format — Executive Summary Sections

Every one of the five executive-summary sections is written in this shape
and no other. Prose paragraphs are gone. The reader is a CIO on a phone at
6:45 am; they get the facts, the tension between the facts, and the one
sentence that tells them what to do with it.

## The shape

```
<Title — a named tension, not a topic>
The facts:
  • fact with a number
  • fact with a number
  • fact with a number (3–4 bullets, never more than 5)
The tension: one or two sentences on why the facts do not agree.
Bottom line: one sentence. What it means for positioning or what to watch.
```

## The canonical example (Global Macro Regime, 15 SEP 2026)

**Global Macro Paradox — Acceleration Meets Deceleration**

The facts:
- US PMI 56.0 (84th percentile), Euro Stoxx 50 at 6,299 (100th percentile) signal re-acceleration
- But US GDP SAAR slowed to 1.5% from 2.1%; China at 4.3% from 5.0% with PMI 49.5 (contraction)
- US 10Y at 4.96% (90th percentile) vs Fed funds 3.63% — bond market tightening for the Fed; real economy already stressed
- BOJ at 1.0% (86th percentile, up from 0.75%) driving yen carry unwind; India INR at 96.15 (91st percentile) — EM pressure building within 60–90 days

The tension: DM growth appears accelerating on surveys, but nominal GDP growth is already decelerating and real tightening is embedded in 10Y yields. China weak prevents commodity reflation from sustaining. Central banks caught between growth signals (false) and real deceleration (true).

Bottom line: Equity valuations pricing growth re-acceleration; macro data pricing slowdown. BOJ is the underappreciated tail risk for India liquidity flows.

## What the example does that prose did not

1. **The title names the paradox.** "Global Macro Regime" is a label; "Acceleration Meets Deceleration" is a thesis. A reader who only sees the title still knows the argument.
2. **Facts are separable.** Each bullet stands alone, carries its own number and percentile, and can be checked against the data table. No bullet depends on the one before it.
3. **The tension is explicit.** Prose buried the contradiction in the middle of a 90-word sentence. Here it has its own line and its own label.
4. **The bottom line is actionable.** It says what is priced versus what the data says, and names the one thing to watch. It does not summarise the facts again.

## Hard rules

- Title: 4–12 words, an em-dash or colon splitting a subject from the tension is ideal. Never the bare section label.
- Facts: 3–5 bullets. Every bullet has at least one number. Start with the number or the indicator name, never with "The". Use "But" to open a bullet that contradicts the one above it.
- Tension: 1–2 sentences, at most 45 words. Must name the two things that disagree. No new numbers unless they resolve the disagreement.
- Bottom line: 1 sentence, at most 30 words. Must contain either a positioning call (overweight / avoid / hedge / hold) or a specific thing to watch with a threshold.
- Wrap key figures in `<strong>` inside bullets, tension and bottom line. Nothing else is markup; the structure is built for you from the fields you return.
- Section 05 (Key Risks): facts are the risks ranked by probability × impact, one per bullet, each with the number that makes it a risk. Bottom line is the single data point to watch this week.
- Total per section: under 130 words. If you are over, cut a bullet, never the bottom line.

## Anti-patterns

- A title that is just the label ("Liquidity Conditions") or a headline with no tension ("Strong Liquidity").
- A bullet that restates another bullet with a different number.
- A tension line that says "mixed signals" or "on the other hand" — name the two sides.
- A bottom line that is a summary of the facts rather than a consequence of them.
- More than one idea per bullet. Split it.
