# Held-out results, first run (re-scored at fbaf2f3 below)

Recorded on minima (macOS 27.0.1, build 26A434, SystemLanguageModel.default, AFM 3 Core
Advanced, temperature 0) at 1845edc. The verifier was not changed after this run.

v2 = current evidence schema and verifier (`recorded/v2-heldout.json`).
v1 legacy = 273f429 schema and buildProposal (`recorded/v1-heldout.json`).

| held-out (60 notes; one-shot is over the 54 with no follow-up expected) | one-shot | false-fill | follow-up rate |
|---|---|---|---|
| v2 all | 42.6% (23/54) | 18.3% | 30.0% |
| v2 en | 43.8% (14/32) | 14.3% | 31.4% |
| v2 es | 40.9% (9/22) | 24.0% | 28.0% |
| v1 legacy all | 11.1% (6/54) | 23.3% | 63.3% |
| v1 legacy en | 12.5% (4/32) | 8.6% | 51.4% |
| v1 legacy es | 9.1% (2/22) | 44.0% | 80.0% |

Tuning set, v2 re-recorded at the same head: one-shot 86.7% (98/113), false-fill 0.0%,
follow-up 17.4%. The gap is overfitting to the tuning notes.

## v2 failures by cause (36 cases; some have more than one cause)

1. Junk spans counted as a second location, so the note looks ambiguous (7):
   ho-en-010 "last night", ho-en-027 "4", ho-en-029 "a 5 out of 10", ho-en-032 "throbbing",
   ho-es-006 "hoy", ho-es-015 "hinchada", ho-es-021 "dolor horrible"/"anoche".
2. Dictation typos in the part or side are not matched (6): ho-en-002 "rite knee",
   ho-en-005 "sholder blade", ho-en-009 "lef hand", ho-en-014 "right ankel",
   ho-en-018 "upper bak", ho-en-020 "rite toes".
3. Denial and self-correction scope (5): "not my knee, my right ankle" (ho-en-025),
   "no es mi rodilla, es el tobillo derecho" (ho-es-018) and "left wrist no wait right wrist"
   (ho-en-028) drop the kept part; ho-es-023 keeps the corrected-away left wrist;
   ho-es-014 "lo noté" is read as a denial.
4. Regional or clinical part words missing from the lexicon (3): chamorra (ho-es-009),
   isquiotibial (ho-es-012), cervical (ho-es-016).
5. Stray side accepted (1): ho-es-024 "a la derecha de la tienda" filled right_knee.
6. Activity false fills: any span in the note passes (11): been like that, jammed it,
   stubbed, been bothering me, left work, meduele, comí a las 11, fastidiado,
   cuando la giro, salí del trabajo; ho-es-017 "de pie" vs "estar de pie".
7. Quality recall: the model drops a second quality or paraphrases ("aching" for "achy"),
   so the verbatim check rejects it (9): ho-en-004, 006, 008, 011, 014, 018, 021, 031,
   ho-es-023. ho-es-021 accepts "horrible" as a quality (false fill).
8. Fields cleared when a location follow-up is asked (2): ho-es-020 and ho-es-018 lose a
   stated rating.
9. Onset: the model rewrote "antier" as "desde ayer" and the verifier rightly rejected it
   (ho-es-004).
10. Model guardrail error "May contain sensitive content" (1): ho-en-030.

Also seen: ho-en-025 duration reads "Since since yesterday".

## Cause attribution (from the recorded model output)

Each failure was checked against the raw v2 output: was the model's answer right with an
honest quote, and did the verifier keep it? Causes: (a) model wrong, (b) verifier or
lexicon broke a right answer or let a wrong one through, (c) schema or prompt gap,
(d) label error.

| cause | en (20 failing) | es (16 failing) | all (36) |
|---|---|---|---|
| (a) model only | 12 | 9 | 21 |
| (b) verifier/lexicon only | 1 | 5 | 6 |
| (d) label only | 1 | 1 | 2 |
| mixed (a)+(b), one also (d) | 6 | 1 | 7 |
| (a) contributes | 18 | 10 | 28 |
| (b) contributes | 7 | 6 | 13 |
| (d) contributes | 2 | 1 | 3 |

(a) only: en-002 (invented side "left" for "rite knee"), 004, 006, 008, 011, 021, 031
(quality dropped or paraphrased), 010, 027, 029 (junk span as a location), 028 (missed
"no wait"), 030 (guardrail); es-001, 005, 008, 024 (junk activity, invented side), 004
(rewrote "antier"), 006, 015, 021 (junk location), 023 (negated the wrong side).
(b) only: en-025 and es-018 (verifier dropped a right part on denial scope), es-014
("lo noté" read as a denial), es-009 chamorra and es-012 isquiotibial (lexicon), es-020
(rating cleared when a location follow-up is asked).
(d) only: en-016 "jammed it" and es-017 "estar de pie" vs "de pie" (labels too strict).
Mixed: en-005, 009, 014, 018, 020 (dictation typo not in the lexicon, plus a model error),
en-032 (junk location, plus the verifier rejected "a few weeks ago"), es-016 (cervical
missing, plus junk activity).
No failure is only (c). The activity field and junk location spans may be partly a prompt
gap, but they are counted as (a) here.

False fills: 12 events (10 activity, 1 quality, 1 location). 10 are (a), where the model put
a non-activity span in activity and the verifier only checked that the span exists. 2 are
(d) (en-016, en-020).

## Trust-the-model bound (`--pipeline trust`)

The model's raw fields and negated flags, keeping a field only if its evidence quote is
a real span. The part lexicon still maps the quote to a region, because the schema has
no region id. There are no side, denial, rating or activity rules.

| | one-shot | false-fill | follow-up rate |
|---|---|---|---|
| held-out trust all | 29.6% (16/54) | 41.7% | 28.3% |
| held-out trust en | 34.4% (11/32) | 31.4% | 25.7% |
| held-out trust es | 22.7% (5/22) | 56.0% | 32.0% |
| tuning trust all | 38.1% (43/113) | 34.8% | 27.5% |

Trusting the model scores below the verified v2 (42.6% and 18.3%), so the rules help on
balance. If every (b)-only and (d)-only case on held-out were fixed, one-shot would rise to at
most 30/54 (55.6%). The remaining failures need a better model answer.

Caveat on the trust bound: the schema has no region id, so the bound still runs the part
lexicon (`partsIn`) and the onset resolver on the model's quotes. It is "model plus lexicon",
not the model alone, and it does not run the side, denial, rating, or activity rules.

## Re-score at fbaf2f3 (after the review-fix commits)

The recorded model outputs (`recorded/v2-heldout.json`) were replayed through the verifier
at fbaf2f3, once, with no model re-run. The verifier fixes since the first run came from
code review of #35 to #37 and were tested on new synthetic cases, never on these notes. A
review change that was derived from these notes (a part-lexicon filter for off-map parts) was
dropped for that reason.

| held-out (60 notes) | one-shot | false-fill | follow-up rate | wrong-value fills |
|---|---|---|---|---|
| v2 all | 42.6% (23/54) | 18.3% | 30.0% | 7 |
| v2 en | 43.8% (14/32) | 14.3% | 31.4% | 5 |
| v2 es | 40.9% (9/22) | 24.0% | 28.0% | 2 |
| trust all | 29.6% (16/54) | 41.7% | 28.3% | 6 |

The numbers are identical to the first run, so the fixes did not move held-out in either
direction. This set is no longer blind: its failures and causes are written above, so a
later gain here would not be evidence by itself.

`heldout/thresholds.json` is a CI floor on these numbers (`--check --thresholds`). It guards
against regressions and is not a target. Do not raise it by tuning the verifier on these
notes.

Tuning set at the same head: one-shot 86.7% (98/113), false-fill 0.0%, follow-up 17.4%.
