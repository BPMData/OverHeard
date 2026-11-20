import json,sys,sentencepiece as spm,copy
l=sys.argv[1]; d=f'../proto/models/opus-mt-en-{l}/onnx_tmp/'
tpl=json.load(open('mul_tok.json'))
vocab=json.load(open(d+'vocab.json')); sp=spm.SentencePieceProcessor(model_file=d+'source.spm')
n=max(vocab.values())+1; arr=[None]*n
for tok,i in vocab.items():
    s=sp.piece_to_id(tok)
    score=sp.get_score(s) if s!=sp.unk_id() or tok=='<unk>' else -100.0
    arr[i]=[tok,float(score)]
for i in range(n):
    if arr[i] is None: arr[i]=[f'<unused{i}>',-100.0]
t=copy.deepcopy(tpl); t['model']['vocab']=arr; t['model']['unk_id']=vocab['<unk>']
pad=vocab['<pad>']
t['added_tokens']=[{'id':vocab['</s>'],'special':True,'content':'</s>','single_word':False,'lstrip':False,'rstrip':False,'normalized':False},
 {'id':vocab['<unk>'],'special':True,'content':'<unk>','single_word':False,'lstrip':False,'rstrip':False,'normalized':False},
 {'id':pad,'special':True,'content':'<pad>','single_word':False,'lstrip':False,'rstrip':False,'normalized':False}]
json.dump(t,open(d+'tokenizer.json','w'),ensure_ascii=False)
print(l,n,vocab['</s>'],vocab['<unk>'],pad)
