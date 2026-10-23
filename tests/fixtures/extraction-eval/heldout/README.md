# Held-out extraction eval set

60 notes (35 en, 25 es) written blind: Grok ran in an empty temp dir with no repo access,
given only `brief.md` (split into an English run and a Spanish run). The verifier and prompt
were never tuned against these notes. Committed before any extraction ran on them.

Label review (labeling mistakes only, tagged `label-fix`):
- ho-en-033, ho-es-022: unmapped shin had `side` set; the label convention (tuning set
  en-039, es-037) is `side: null` for unmapped parts.

Do not tune the verifier or prompt against failures here. Add new tuning cases to
`../cases.json` instead.
