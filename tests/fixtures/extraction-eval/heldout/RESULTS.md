# Held-out results, first run

Recorded on minima (macOS 27.0.1, build 26A434, SystemLanguageModel.default, AFM 3 Core
Advanced, temperature 0) at 1845edc. The verifier was not changed after this run.

v2 = current evidence schema and verifier (`recorded/v2-heldout.json`).
v1 legacy = 273f429 schema and buildProposal (`recorded/v1-heldout.json`).

| held-out (54 no-follow-up cases) | one-shot | false-fill | follow-up rate |
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
