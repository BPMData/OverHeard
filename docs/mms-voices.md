# Meta MMS reader voices

OverHeard's second voice engine. Swahili, Haitian Creole, Somali, Indonesian and Turkish read
aloud with [Meta MMS](https://huggingface.co/facebook/mms-tts) VITS models (`facebook/mms-tts-<iso3>`),
which the owner preferred to the Piper voices after listening to samples (November 2026).
Skipped: Arabic (no better than Piper's Kareem), Persian for Dari (poor), the community Swahili
female voice.

## How it works

- `src/tts/voices.ts`: MMS voices are ordinary entries with `engine: 'mms'`, `mmsIso3` and
  `downloadBytes`. `MMS_VOICE_BASE_URL` (override with `VITE_MMS_VOICE_BASE_URL` at build time)
  points at the hosted models; `MMS_ATTRIBUTION` is shown under the voice in Settings.
- `src/tts/mmsTokenizer.ts`: port of Transformers' `VitsTokenizer` (normalize, drop characters
  the voice doesn't know, blank id 0 between characters). No phonemizer or uroman is needed for
  these five languages. `mmsTokenizer.test.ts` checks it against ids from the Python tokenizer.
- `src/tts/mmsVocab.ts`: the five `vocab.json` files (a few hundred bytes each) ship with the app.
- `src/tts/mmsEngine.ts`, used by `src/tts/piperWorker.ts`: downloads the model once into OPFS
  (`mms/<modelId>.onnx`), runs it with the same ONNX Runtime WebAssembly build Piper uses
  (`/ort/`), one sentence at a time, and writes a 16 kHz WAV. The worker's loudness boost
  (`src/tts/loudness.ts`) lifts the quiet Haitian Creole voice.
- `src/tts/voiceStorage.ts`: `createMmsVoiceStorageCategory` lists the saved models under
  Settings → Space used on this device ("Downloaded Meta MMS voices").

## Converting another language

No browser-ready ONNX exists for these models, so each was converted once:

```sh
python3.12 -m venv venv
./venv/bin/pip install "optimum[exporters]==1.27.0" "transformers==4.46.3" "torch==2.5.1" onnxruntime
./venv/bin/optimum-cli export onnx --model facebook/mms-tts-swh --task text-to-audio --opset 17 out/swh
./venv/bin/python docs/mms-voices/weight_only_int8.py out/swh/model.onnx mms-tts-swh/model_quantized.onnx
```

Pitfalls:

- The export ends with a `ShapeError` on validation. That is expected: VITS samples random
  noise for durations, so reference and ONNX outputs differ in length. `model.onnx` is still written.
- Use `--opset 17`. The default (11) has no per-channel `DequantizeLinear`.
- Don't use `onnxruntime.quantization.quantize_dynamic`. It makes a 38 MB model with int8 Conv
  kernels, which ONNX Runtime's WebAssembly build runs slowly: a short Swahili sentence took
  7.1 s warm in Chrome, against 4.4 s for float. `weight_only_int8.py` stores the weights as
  int8 (about 28 MB instead of 114 MB) and turns them back into float in the graph, so the
  browser still runs float kernels: 3.7 s for the same sentence.
- Check the language's `tokenizer_config.json` says `"is_uroman": false` and
  `"phonemize": false`. Languages that need uroman need a romanizer first.
- Get tokenizer ids for the test fixture (`src/tts/__fixtures__/mms-tokenizer-fixtures.json`)
  from `AutoTokenizer.from_pretrained('facebook/mms-tts-<iso3>')(text)['input_ids']`.

## Speed

MMS runs one sentence in about 1.5× its own length on one thread (Chrome, M-series Mac): most
of the time is the HiFi-GAN vocoder's Conv layers. OverHeard isn't cross-origin isolated, so
ONNX Runtime gets one thread. Read-aloud prefetches the next line, which hides some of this.
Ways to make it faster: cross-origin isolation (COOP/COEP headers) for multithreaded WebAssembly,
or ONNX Runtime's WebGPU backend.

To change a voice's pace, save the model locally with a different `speaking_rate` in
`config.json` (it is baked into the ONNX graph) and export from that folder. Indonesian ships
at 0.88 (`model_quantized_rate088.onnx`, about 10% slower), because Meta's default sounded
rushed. Use a new file name (`mmsFile` in `voices.ts`) rather than overwriting, so cached
copies of the old file can't be mixed up with the new one.

Then add `mms-tts-<iso3>/model_quantized.onnx` to the `BPMData/overheard-voices` repository
(GitHub Pages, CORS `*`), its vocabulary to `mmsVocab.ts`, and an `mmsVoice(...)` entry to
`voices.ts` with the file size in bytes.

## License

The MMS models are CC BY-NC 4.0 (Pratap et al., *Scaling Speech Technology to 1,000+ Languages*,
2023, arXiv:2305.13516). Non-commercial use only; keep the attribution in Settings.
