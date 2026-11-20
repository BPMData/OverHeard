# Spike: on-device translation for Urdu, Swahili, Somali, Haitian Creole, Pashto, Dari

Goal: Chrome's built-in Translator API lacks `ur`, `sw`, `so`, `ht`, `ps` and `prs`, so these
always go to the paid server translator and fail offline. Can an in-browser model (in a Web
Worker, like Piper TTS) cover them without hurting caption latency? English → X only.

**Measured:** desktop Chrome on an Apple M4 laptop, 5 classroom sentences (8–16 words),
median of a second pass after a warm-up. Prototype code is in
[`offline-translation-spike/`](offline-translation-spike/) (not wired into the app).

## Recommendation

| Language | Use | Download | Median / sentence | License | Live-caption fast enough? |
|---|---|---|---|---|---|
| Urdu `ur` | **Bergamot en-ur** (Firefox Translations) | 35 MB | **~60 ms** | MPL-2.0 | Yes. Quality good. |
| Dari `prs` | **Bergamot en-fa** (Persian) | 21 MB | **~25 ms** | MPL-2.0 | Yes, but it's Iranian Persian, not Afghan Dari (see below) |
| Swahili `sw` | **Opus-MT en-sw**, self-converted int8 | ~138 MB | **~160–210 ms** | Apache-2.0 | Yes. Quality acceptable. |
| Haitian Creole `ht` | none good on-device yet | | | | Opus-MT en-ht (121 MB, ~125 ms) is too poor; NLLB is good but ~2 s |
| Somali `so` | NLLB only | ~910 MB | ~1.8 s | **CC-BY-NC-4.0** | No (too slow; NC license) |
| Pashto `ps` | NLLB only | ~910 MB | ~2.0 s | **CC-BY-NC-4.0** | No (too slow; NC license) |

Short version: **ship Urdu (Bergamot), Swahili (Opus-MT) and, with a caveat, Dari (Bergamot
Persian) on-device; keep Haitian Creole, Somali and Pashto on the online translator.**
Bergamot is the clear winner where it exists: smallest, fastest and best quality.

## Candidates

### 1. Opus-MT (Helsinki-NLP) via Transformers.js
- Only **en-ur, en-sw, en-ht** exist (plus multilingual `en-mul`/`en-inc`/`en-cus`, which need
  a target-language token and are weaker). No en-so, en-ps, en-fa/prs.
- License Apache-2.0. Original weights ~277–306 MB (fp32).
- Xenova/onnx-community publish **no** ONNX for these three; I converted them with
  `optimum` and int8-quantized. Quantizing the *merged* decoder does nothing (weights sit in
  subgraphs); quantize `decoder_model` and `decoder_with_past_model` first, then merge
  (`quant2.py`). Result per language: encoder ~44–51 MB + decoder ~75–90 MB = **~121–143 MB**.
  Marian repos have no `tokenizer.json`, so `mktok.py` builds one (Unigram from
  `source.spm` scores + `vocab.json` ids).
- Latency (WASM, int8): ur 230 ms, sw 213 ms (159 ms single-threaded), ht 126 ms. First load
  from local cache 1–3 s after download. fp32 on **WebGPU** (544 MB) was 176 ms for sw, so
  no real gain; int8 on WebGPU hung (integer MatMul not supported). **Use WASM, one thread.**
- Quality (my own reading; see note below):
  - ur: poor. Invents words (page "24", "درپردہ کتاب", repeated "جمع‌شُدہ"). Bergamot is far better.
  - sw: acceptable, readable, a few repeats ("mvukizo, mvukizo").
  - ht: bad, hallucinated and loops, same in fp32 so it isn't quantization damage.

### 2. Bergamot / Firefox Translations (`@browsermt/bergamot-translator` WASM)
- Registry (Mozilla bucket `.../db/models.json`) has, of the six, only **en-ur** (31.6 MB,
  base-memory, FLORES BLEU 25.9) and **en-fa** (17.1 MB tiny, BLEU 23.7). Nothing for
  sw/so/ht/ps. Models are MPL-2.0; the runtime is open source (MPL-2.0).
- Plugs into the npm package's `LatencyOptimisedTranslator` through a custom `registryUrl`
  (files must be decompressed; two-letter codes only). Runs in its own worker, single thread.
- Urdu quality was fluent and accurate on all 5 sentences (one number word slightly off).
  Persian was fluent.
- Dari caveat: Dari is Afghan Persian. The en-fa model produces Iranian-standard Persian;
  Afghan readers understand it, but vocabulary and register differ (e.g. some everyday words).
  Needs a native Dari speaker to confirm before switching it on. NLLB's `prs_Arab` output
  was the same style anyway, so it isn't better here.

### 3. NLLB-200-distilled-600M (Xenova ONNX)
- Covers all six (`urd_Arab swh_Latn som_Latn hat_Latn pbt_Arab prs_Arab`).
- **License CC-BY-NC-4.0**: non-commercial. A free school tool arguably qualifies, but it is a
  risk (and rules out any paid use), so treat as "avoid unless Meta licensing is cleared".
- Size: int8 encoder 419 MB + decoder 475 MB = **912 MB download**, ~114 s first load with
  download on this connection. q4f16 on WebGPU (1.25 GB) failed to initialise (out of memory).
- Latency on WASM int8: **1.2–3.4 s per sentence, median ~1.7–2.2 s** for every language.
  Far too slow for live captions; it could only work as a slow background "polish" pass.
- Quality: best of the three for ht, so, ps (ht fluent, so/ps usable with occasional garbage
  on technical words, e.g. Pashto "condensation").

## Quality note
I could not use an online translator to back-translate (Google's unofficial endpoint blocks
scripted requests, and there is no server key locally). Ratings above are my own reading of
the outputs against the English, not a measured score; have a native speaker spot-check
Urdu, Swahili and Dari before shipping. Sample sentences, e.g.
"Please open your textbooks to page forty-two." and
"Remember that the water cycle has four steps: evaporation, condensation, precipitation, and collection."

## Integration notes (if we build it)
- Latency: on-device Bergamot (25–60 ms) is faster than a server round trip, so it also helps
  online. Opus-MT sw (~160 ms) is comparable to the server.
- Hosting: the models are 35 MB / 21 MB (Bergamot) and ~140 MB (sw). Host them from Cloud
  Storage or the Cloud Run image, cache via the service worker, and download only when the
  teacher/student picks that language (same one-pack-per-click approach as the voices).
- Chrome's built-in API and Bergamot both emit sentence-level output; reuse the existing
  Auto-mode fallback order: Chrome API → local model (new) → server.
- Run in a Worker. Single-thread WASM avoids needing COOP/COEP headers on Cloud Run.
- Licenses: Apache-2.0 (Opus-MT) and MPL-2.0 (Bergamot) are fine; record attributions.

## Open questions / next steps
1. Native-speaker review for Urdu, Swahili, Dari.
2. Haitian Creole, Somali, Pashto: look at newer small models (e.g. distilling NLLB-600M to
   a 50–100 MB Bergamot-style student with a permissive licence, or the permissively-licensed
   M2M100-418M, MIT, ~similar size to NLLB so still too slow) before giving up on on-device.
3. Build the real integration for ur/sw/prs behind the existing Auto mode.

**Decision (owner):** include Dari via Bergamot en-fa as an option alongside Urdu, since the
Bergamot engine is being added anyway. It costs only ~21 MB more. It stays opt-in with online
fallback, and no native-speaker review is available, so label it as approximate Persian.
