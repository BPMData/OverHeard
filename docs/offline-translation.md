# On-device translation models (Bergamot, Opus-MT)

When Chrome's built-in Translator API can't translate a language (Safari, Firefox, some
Chromebooks, and languages Chrome lacks: Urdu, Dari, Swahili), OverHeard can translate on the
device with its own models, in Web Workers. Background: [`offline-translation-spike.md`](offline-translation-spike.md).

| Engine | Languages | Download | Warm sentence (M-series, Chrome) | License |
|---|---|---|---|---|
| Bergamot (Firefox Translations) | es, pt, fr, uk, ru, ar, zh, vi, hi, bn, ur, id, ja, tr, Dari via Persian (approximate) | 20–48 MB each | ~25–120 ms | MPL-2.0 |
| Opus-MT (Helsinki-NLP), int8 ONNX via Transformers.js | Swahili | 132 MB | ~200–360 ms | Apache-2.0 |

Haitian Creole, Somali and Pashto stay online: no small model is good enough yet.

## How it fits together (`src/translation/bergamot/`)

- `models.ts` / `catalog.ts`: every model with its files, exact sizes and SHA-256. Bergamot
  models come from `catalog.ts`; `OPUS_MODELS` adds Swahili with `engine: 'opus'` and its own
  `baseUrl`. `ON_DEVICE_MODELS` is both.
- `store.ts`: downloads a model, checks every file, and saves them in Cache Storage
  (`overheard-bergamot-v1`, kept by the service worker across deploys). Same for both engines.
- `engine.ts`: availability, shared downloads, translators. `createBergamotTranslator` hands
  `engine: 'opus'` models to `opus.ts` (one worker per language) and `opusWorker.ts`, which runs
  Transformers.js 3.7.6 on the `/ort/` ONNX Runtime files the voice engine already serves.
  The worker reads model files only from the saved-model cache (a Transformers.js custom cache),
  never the network, so a saved model works offline. Single-thread WebAssembly: no COOP/COEP.
- `src/onDevice.ts`: Chrome first, then these; a missing model waits for a click on its
  download button, which shows the size first ("Download Swahili translation (132 MB)").
- `storage.ts`: "On-device translation models" in Settings → Space used on this device.
  Swahili also uses the voice engine runtime (`/ort/`), counted under "Downloaded voices".

## Hosting

- Bergamot: `https://bpmdata.github.io/overheard-voices/bergamot/` (repo `BPMData/overheard-voices`).
  Override with `VITE_BERGAMOT_BASE_URL`.
- Opus-MT: `https://bpmdata.github.io/overheard-translation-models/` (repo
  `BPMData/overheard-translation-models`), its own Pages site because each Pages site has a 1 GB
  limit and overheard-voices is at ~800 MB. Same domain (allowed on school Wi-Fi), CORS `*`.
  Override with `VITE_OPUS_BASE_URL`.

GitHub Pages gzips responses, so downloads are checked against the catalog's sizes, not
`Content-Length`. A changed model goes in a new folder with a new catalog entry, so saved copies
of old files are never mixed with new ones (old files show as leftovers in Settings).

## Converting another Opus-MT model

Use the scripts in [`offline-translation-spike/`](offline-translation-spike/) (`convert.sh`,
`mktok.py`, `quant2.py`: ONNX export with Optimum 1.27, a `tokenizer.json` built from the
SentencePiece model, int8 quantization of the unmerged decoders before merging). Upload the
folder to the models repo, then add an entry to `OPUS_MODELS` with `shasum -a 256` of each file.

## Attributions

- Bergamot models and runtime (`@browsermt/bergamot-translator`): Mozilla, MPL-2.0.
- Opus-MT en-sw: Helsinki-NLP (Tiedemann & Thottingal, EAMT 2020), Apache-2.0
  (<https://huggingface.co/Helsinki-NLP/opus-mt-en-sw>). Converted to ONNX and int8, nothing else.
- Transformers.js: Hugging Face, Apache-2.0.

The About dialog and the Settings storage category repeat these credits.
