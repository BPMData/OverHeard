Throwaway spike code (not part of the app; not built or tested by CI). See
[`../offline-translation-spike.md`](../offline-translation-spike.md) for results.

- `convert.sh`, `mktok.py`, `quant2.py`: export Helsinki-NLP `opus-mt-en-{ur,sw,ht}` to ONNX,
  build a `tokenizer.json` (Transformers.js needs one; Marian ships none), int8-quantize.
  Needs Python 3.12, `optimum[exporters]==1.27.0`, `transformers==4.46.3`, `torch==2.5.1`.
  Paths assume a sibling `proto/models/` directory and a `mul_tok.json` template
  (`Xenova/opus-mt-en-mul/tokenizer.json`).
- `server.mjs`, `index.html`, `tw.js`: benchmark page, e.g.
  `index.html?job=tf&model=local:opus-mt-en-sw&device=wasm&dtype=q8` or `?job=bergamot&to=ur`
  (Bergamot needs `@browsermt/bergamot-translator` in `vendor/` and its models in `models/bergamot/`).
