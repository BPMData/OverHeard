set -e
for l in ur sw ht; do
  out=../proto/models/opus-mt-en-$l
  ./venv/bin/optimum-cli export onnx --model Helsinki-NLP/opus-mt-en-$l --task text2text-generation-with-past $out/onnx_tmp >/dev/null 2>&1 || ./venv/bin/optimum-cli export onnx --model Helsinki-NLP/opus-mt-en-$l --task text2text-generation-with-past $out/onnx_tmp
  echo exported $l
done
