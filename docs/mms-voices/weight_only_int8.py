"""Weight-only int8 for an exported MMS VITS model: python weight_only_int8.py in.onnx out.onnx

Every large float weight (Conv, ConvTranspose, MatMul, Gather tables) is stored as int8 with a
per-output-channel scale and turned back into float by a DequantizeLinear node, so the model
downloads at about a third of its size but still runs float kernels. ONNX Runtime's
WebAssembly build has slow int8 Conv kernels: a fully quantized model (quantize_dynamic) ran
about 60% slower in the browser than float, while this keeps float speed.
"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

MIN_ELEMENTS = 1024  # Leave small tensors (biases, norms) as float

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src)
graph = model.graph
consumers = {}
for node in graph.node:
    for index, name in enumerate(node.input):
        consumers.setdefault(name, []).append((node, index))

new_inits, new_nodes, replaced = [], [], 0
for init in list(graph.initializer):
    if init.data_type != onnx.TensorProto.FLOAT:
        continue
    weights = numpy_helper.to_array(init)
    if weights.size < MIN_ELEMENTS or weights.ndim < 2:
        continue
    uses = consumers.get(init.name, [])
    if not uses or any(node.op_type not in ('Conv', 'ConvTranspose', 'MatMul', 'Gather') for node, _ in uses):
        continue
    # Per-channel on the axis that is one output channel: 0 for Conv weights and Gather
    # tables, 1 for ConvTranspose (C_in, C_out/groups, k) and MatMul (K, N) weights.
    op = uses[0][0].op_type
    axis = 1 if op in ('ConvTranspose', 'MatMul') else 0
    moved = np.moveaxis(weights, axis, 0).reshape(weights.shape[axis], -1)
    scale = np.abs(moved).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    shape = [1] * weights.ndim
    shape[axis] = -1
    q = np.clip(np.round(weights / scale.reshape(shape)), -127, 127).astype(np.int8)
    q_name, s_name, z_name = init.name + '_q', init.name + '_scale', init.name + '_zp'
    new_inits += [
        numpy_helper.from_array(q, q_name),
        numpy_helper.from_array(scale.astype(np.float32), s_name),
        numpy_helper.from_array(np.zeros(scale.shape, np.int8), z_name),
    ]
    new_nodes.append(helper.make_node('DequantizeLinear', [q_name, s_name, z_name], [init.name], axis=axis,
                                      name=init.name + '_dq'))
    graph.initializer.remove(init)
    replaced += 1

graph.initializer.extend(new_inits)
# DequantizeLinear outputs must exist before their users: put the new nodes first.
nodes = new_nodes + list(graph.node)
del graph.node[:]
graph.node.extend(nodes)
if model.opset_import[0].version < 13:
    raise SystemExit('Per-channel DequantizeLinear needs opset 13 or later')
onnx.save(model, dst)
print(f'{replaced} weights to int8 → {dst}')
