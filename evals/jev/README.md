# Jev pain-suggestion eval

`cases.jsonl` has 38 hand-labelled descriptions: plain English, negations ("not 7/10",
"not the left one"), decimals, unrelated numbers ("a 5k"), vague and no-body notes,
a red-flag case, and Spanish, French, German, Portuguese and Japanese.
Labels are judgment calls; `level` is compared by band (none, mild 1-3, moderate 4-5,
severe 6-7, very severe 8-10) because Jev answers in bands. `any_region` means any
one of the listed regions counts.

Jev is scored on **side and pain level only**. Region accuracy applies to the map
providers (demo / openai / anthropic / grok), which remain the source of regions.

Run `uv run python evals/jev/run_eval.py --env-file <path to .env>`. Targets default to
`jev-1.13.0,jev-1.14.0,demo,default` (default = `LLM_PROVIDER`). Raw rows land in
`.tmp/jev-eval/` and are not committed. Jev cost uses input tokens at $0.042/M.
