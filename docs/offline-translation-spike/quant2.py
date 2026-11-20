import sys,os,onnx
from onnxruntime.quantization import quantize_dynamic,QuantType
from optimum.onnx.graph_transformations import merge_decoders
l=sys.argv[1]; root=f'../proto/models/opus-mt-en-{l}/'; t=root+'onnx_tmp/'
for m in ['decoder_model','decoder_with_past_model']:
    quantize_dynamic(t+m+'.onnx',t+m+'_q.onnx',weight_type=QuantType.QUInt8)
merged=merge_decoders(t+'decoder_model_q.onnx',t+'decoder_with_past_model_q.onnx',save_path=root+'onnx/decoder_model_merged_quantized.onnx',strict=False)
print(l,os.path.getsize(root+'onnx/decoder_model_merged_quantized.onnx')/1e6, 'MB')
