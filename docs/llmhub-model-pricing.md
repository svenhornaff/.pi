# LLMHub Model Pricing Reference

Source: T-Systems LLMHub pricing/rate-limit screenshots (provided by PO), 2026-08-29.
This is the **authoritative source of truth** for LLMHub per-model cost in this
`~/.pi` setup — supersedes any cost figures previously guessed, estimated, or
carried over between models in `~/.pi/agent/models.json`.

Cache-read/cache-write prices are **not published** by LLMHub in this table (only
blended input/output €/M). Where `~/.pi/agent/models.json` sets `cacheRead`/`cacheWrite`,
those remain **heuristic estimates** (10% / 125% of input, per Anthropic's standard
cache-pricing ratio) until confirmed against a real invoice line item — flagged
per-model with `_costNote` in `models.json`.

## Full catalog (35 models)

| Cloud Provider | Tier | Model Name | Input €/M | Output €/M | Location | RPM | TPM | Context Window |
|---|---|---|---|---|---|---|---|---|
| GCP | Standard | Claude Haiku 4.5 | 0.99 | 4.95 | Europe | 1,200 | 1,200,000 | 200,000 |
| GCP | Standard | Claude 4.5 Sonnet | 2.97 | 14.85 | Europe | 900 | 900,000 | 200,000 |
| GCP | Standard | Claude Sonnet 4.6 | 7.28 | 27.30 | Europe | 1,200 | 1,200,000 | 1,000,000 |
| GCP | Standard | Gemini 2.5 Flash | 0.27 | 2.25 | Europe | 2,000 | 8,000,000 | 1,048,576 |
| GLOBAL | Standard | Gemini 3.1 Pro | 1.80 | 10.80 | – | 150 | 750,000 | 1,048,576 |
| GCP | Standard | Gemini 3.5 Flash | 1.49 | 8.91 | Europe | 300 | 300,000 | 1,048,576 |
| GLOBAL | Standard | Gemini 3 Flash (Preview) | 0.45 | 2.70 | – | 2,000 | 8,000,000 | 1,048,576 |
| GLOBAL | Standard | Gemini 3 Pro | 1.80 | 10.80 | – | 2,000 | 8,000,000 | 1,000,000 |
| GLOBAL | Premium | Gemini 3 Pro Image (Nano Banana Pro) | 1.80 | 108.00 | – | 3 | 15,000 | 65,536 |
| T-Cloud | Standard | Gemma 4 31B Instruct | 0.60 | 1.20 | Germany | 50 | 50,000 | 262,144 |
| T-Cloud | Standard | GLM 5.2 | 4.00 | 8.00 | Germany | 100 | 800,000 | 1,000,000 |
| Microsoft Azure | Standard | GPT 5 | 1.20 | 9.55 | Sweden | 30,000 | 3,000,000 | 400,000 |
| Microsoft Azure | Premium | GPT 5.4 | 2.42 | 14.49 | Sweden | 1,500 | 2,250,000 | 1,000,000 |
| Microsoft Azure | Premium | GPT 5.4 mini | 0.66 | 3.95 | Sweden | 1,500 | 2,250,000 | 400,000 |
| Microsoft Azure | Premium | GPT 5.5 | 4.83 | 28.97 | Sweden | 1,500 | 2,250,000 | 1,050,000 |
| Microsoft Azure | Standard | GPT-5.6 Sol | 4.50 | 27.00 | Sweden | 250 | 375,000 | 1,050,000 |
| Microsoft Azure | Standard | GPT 5 Codex | 1.10 | 8.70 | Sweden | 3,000 | 3,000,000 | 400,000 |
| Microsoft Azure | Standard | GPT 5 Mini | 0.24 | 1.91 | Sweden | 3,000 | 3,000,000 | 400,000 |
| Microsoft Azure | Standard | GPT 5 Nano | 0.05 | 0.39 | Sweden | 45,000 | 45,000,000 | 400,000 |
| Microsoft Azure | Premium | GPT Image 2 | 9.55 | 38.20 | Sweden | 1 | 6,000 | 1,050,000 |
| T-Cloud | Standard | GPT OSS 120B | 0.20 | 0.65 | Germany | 300 | 400,000 | 131,072 |
| T-Cloud | Standard | Jina Embeddings v2 Base De | 0.05 | 0.05 | Germany | 300 | 300,000 | 8,192 |
| T-Cloud | Standard | Meta LLama 3.3 70B | 0.20 | 0.65 | Germany | 300 | 300,000 | 128,000 |
| GCP | Standard | Mistral Medium 3 | 0.36 | 1.80 | Europe | 90 | 120,000 | 128,000 |
| T-Cloud | Standard | Mistral Small 4 119B Instruct | 0.60 | 1.20 | Germany | 50 | 50,000 | 262,144 |
| T-Cloud | Standard | NVIDIA Nemotron 3 Super 120B | 0.60 | 1.20 | Germany | 50 | 100,000 | 256,000 |
| T-Cloud | Standard | Qwen 3.6 35B | 0.60 | 1.20 | Germany | 50 | 100,000 | 262,144 |
| T-Cloud | Standard | Qwen 3.8 27B (Preview) | 0.00 | 0.00 | Germany | 50 | 50,000 | 262,144 |
| T-Cloud | Standard | Qwen 3 Coder 30B Instruct | 0.00 | 0.00 | Germany | 300 | 300,000 | 262,144 |
| T-Cloud | Standard | Qwen 3 Next 80B Instruct | 0.20 | 0.65 | Germany | 300 | 300,000 | 262,144 |
| T-Cloud | Standard | Qwen 3 VL 30B Instruct | 0.20 | 0.65 | Germany | 300 | 300,000 | 128,000 |
| Microsoft Azure | Standard | Embedding Ada 002 | 0.11 | 0.11 | France | 3,000 | 3,000,000 | 8,192 |
| T-Cloud | Standard | Embedding BGE M3 | 0.05 | 0.05 | Germany | 300 | 300,000 | 8,192 |
| T-Cloud | Standard | Whisper Large v3 | 14.61 | 14.61 | Germany | 300 | 436 | 4,096 |
| T-Cloud | Standard | Whisper Large v3 Turbo | 9.21 | 9.21 | Germany | 300 | 690 | 4,096 |

**Notable:**

- Claude Sonnet 4.6 is the most expensive **Standard-tier text** model at 7.28€/27.30€ per M — GPT-5.5 and GPT-5.4 (Premium tier) run higher still.
- The two Whisper audio models top the entire table on input price (14.61€/M and 9.21€/M).
- Several T-Cloud open-weight models (`Qwen 3.8 27B Preview`, `Qwen 3 Coder 30B Instruct`) are genuinely **free (0/0)** — not a config gap, that's the real published rate.
- T-Cloud models use `save_cache`/`cache_salt` for caching, not Anthropic-style `cache_control` — not applicable to the `compat.cacheControlFormat` mechanism pi uses (see `prompt-cache-analysis.md`).

## Cross-check against `~/.pi/agent/models.json` (as of 2026-08-29)

| pi model id | LLMHub catalog name | Catalog input/€M | Catalog output/€M | `models.json` had (before this pass) | Status |
|---|---|---|---|---|---|
| `llmhub/gpt-5` | GPT 5 (Azure, Standard) | 1.20 | 9.55 | 0 / 0 | **Corrected below** — was unconfirmed/zeroed, now filled from catalog |
| `llmhub/claude-sonnet-4.5` | Claude 4.5 Sonnet (GCP, Standard) | 2.97 | 14.85 | 7.28 / 27.30 (wrongly carried over from the 4.6 rate) | **Corrected below** — was a materially wrong estimate, now filled from catalog |
| `llmhub/claude-sonnet-4.6` | Claude Sonnet 4.6 (GCP, Standard) | 7.28 | 27.30 | 7.28 / 27.30 | **Confirmed correct** — matches catalog exactly, no change needed |
| `llmhub/claude-opus-4.6` | *(not present in this catalog)* | — | — | 0 / 0 | **Still unconfirmed** — no "Claude Opus" entry exists in this catalog at all (only Haiku 4.5, 4.5 Sonnet, Sonnet 4.6 are listed for Claude on LLMHub). Left at 0/0 with an explicit warning; may not actually be an offered model on this LLMHub tenant — verify before relying on it for anything cost-sensitive. |

Cache-read/cache-write figures are still not in this catalog (it only has blended
input/output rates) — the 10%/125%-of-input heuristic in `models.json` remains an
estimate, now clearly separated from the (now catalog-sourced) input/output rates.

## Not yet modeled in `~/.pi/agent/models.json`

These catalog entries are not currently configured as pi models at all. Listed here
for completeness / future reference, not acted on in this pass (out of scope — PO
asked for cost-assumption correction on already-configured models, not fleet expansion):

- Claude Haiku 4.5, Claude 4.5 Sonnet's siblings not otherwise listed
- All Gemini variants (2.5 Flash, 3.1 Pro, 3.5 Flash, 3 Flash Preview, 3 Pro, 3 Pro Image)
- GLM 5.2, Gemma 4 31B, Mistral Medium 3 / Small 4, NVIDIA Nemotron 3, Qwen 3.x family, Llama 3.3 70B
- GPT 5.4, GPT 5.4 mini, GPT 5.5, GPT-5.6 Sol, GPT 5 Codex, GPT 5 Mini, GPT 5 Nano, GPT Image 2
- Embedding Ada 002, Embedding BGE M3
- Whisper Large v3, Whisper Large v3 Turbo

## Maintenance

Re-derive this file whenever LLMHub publishes an updated pricing/rate-limit screenshot
or the billing portal (`https://apikey.llmhub.t-systems.net/login`) shows different
numbers. Treat this file, not ad-hoc invoice screenshots or carried-over per-tier
guesses, as the reference to diff `models.json` against going forward.
