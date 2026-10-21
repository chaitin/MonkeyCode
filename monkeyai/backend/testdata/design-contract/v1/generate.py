#!/usr/bin/env python3
"""独立生成冻结夹具；普通测试不运行此脚本。需要 Python 3 与 Node.js。"""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).parent
PUBLISHER = 'fixture-publisher'
RELEASE = '70000000-0000-0000-0000-000000000001'

def encode(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':')).encode()

def sha(b):
    return 'sha256:' + hashlib.sha256(b).hexdigest()

def canonical(v):
    script = '''let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{function j(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(j).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+j(x[k])).join(',')+'}'}process.stdout.write(j(JSON.parse(s)))})'''
    return subprocess.check_output(['node', '-e', script], input=encode(v))

def archive(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    return buf.getvalue()

def ref(name, b, mime='text/plain; charset=utf-8', role='source'):
    return dict(path=name, sha256=sha(b), size=len(b), mime=mime, role=role)

entries = []
manifest_items = {k: [] for k in ['templates', 'design_systems', 'styles', 'directions']}
outer = {}

def add(kind, ident, meta, files, artpath, artbytes):
    refs = sorted(files, key=lambda f: f['path'].encode())
    content = dict(kind=kind, id=ident, metadata=meta, files=refs)
    digest = sha(canonical(content))
    artifact = dict(path=artpath, sha256=sha(artbytes))
    entries.append(dict(**content, content_digest=digest, artifact=artifact))
    plural = {'template':'templates','design-system':'design_systems','style':'styles','direction':'directions'}[kind]
    manifest_items[plural].append(dict(catalog_id=ident, slug=ident, name=meta.get('name',ident), content_digest=digest, **artifact))
    outer[artpath] = artbytes
    return digest

source = {'wrap/SKILL.md':b'# Frozen skill\n', 'template.json':b'upstream template\n', 'shared/a.txt':b'shared\n', 'shared/b.txt':b'shared\n', 'ordinary._source':b'ordinary\n'}
refs = [ref(k,v) for k,v in source.items()]
meta = dict(name='Frozen bundle', template_kind='bundle', downloadable=True, has_skill=True, skillPath='SKILL.md', localizedPrompt={'zh':'创建首页\n'}, localizedDescription={}, examplePrompt='', category='landing',mode='web',triggers=['frozen','web'], author=None, preview=None)
mapping = {'wrap/SKILL.md':'SKILL.md','template.json':'template.json._source','shared/a.txt':'assets/shared.txt','shared/b.txt':'assets/shared.txt'}
export = dict(template_kind='bundle', content_digest='', files=[{k:v for k,v in f.items() if k!='role'} for f in sorted(refs,key=lambda f:f['path'])], source_file_paths=mapping, source_file_refs=[dict(source_path=k,archive_path=v) for k,v in mapping.items()], localized_prompt={'zh':'.prompts/prompt.zh.md'},localized_description={},example_prompt='')
physical = {mapping.get(k,k):v for k,v in source.items()}
physical.update({'template.json':encode(export),'.prompts/prompt.zh.md':'创建首页\n'.encode()})
add('template','sample.bundle',meta,refs,'design/templates/sample.bundle.zip',archive(physical))

meta = dict(name='Frozen prompt',template_kind='prompt',downloadable=False,has_skill=False,skillPath='SKILL.md',localizedPrompt={'en':'Draw\n'},localizedDescription={},examplePrompt='')
export = dict(template_kind='prompt',content_digest='',files=[],localized_prompt={'en':'.prompts/en.md'},localized_description={},example_prompt='')
add('template','sample.prompt',meta,[],'design/templates/sample.prompt.zip',archive({'template.json':encode(export),'.prompts/en.md':b'Draw\n'}))

meta = dict(name='Frozen system',description='',category='landing',content='# Frozen\n',colors=None,capabilities=['layout'],metadata={})
source={'DESIGN.md':b'upstream DESIGN\n','tokens.css':b':root { color: red; }\n'}
refs=[ref(k,v) for k,v in source.items()]
mapping={'DESIGN.md':'DESIGN.md._source'}
export=dict(body='DESIGN.md',content_digest='',files=[{k:v for k,v in f.items() if k!='role'} for f in refs],source_file_paths=mapping)
physical={mapping.get(k,k):v for k,v in source.items()};physical.update({'DESIGN.md':b'# Frozen\n','design-system.json':encode(export)})
add('design-system','sample.system',meta,refs,'design/design-systems/sample.system.zip',archive(physical))

png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=')
meta=dict(slug='sample.style',title='Frozen style',description='',context='web',variant='default',category='landing',preview={'url':'media/preview/url'},recommended=True,localizedTitle={},localizedDescription={})
export=dict(style_slug='sample.style',title='Frozen style',description='',context='web',variant='default',category='landing',preview={'url':'media/preview/url'},recommended=True,localized_title={},localized_description={})
add('style','sample.style',meta,[ref('media/preview/url',png,'image/png','preview')],'design/styles/sample.style.json',encode(export))
outer['design/style-assets/sample.style/media/preview/url']=png
meta=dict(label='Frozen direction',localizedLabel={},prompt={'en':'Design\n'},localizedPrompt={},tokens={'spacing':[4,8]})
add('direction','sample.direction',meta,[],'design/directions/sample.direction.json',encode(dict(label='Frozen direction',localized_label={},prompt={'en':'Design\n'},localized_prompt={},tokens={'spacing':[4,8]})))

taxonomy=dict(modes=[dict(id='web',name='Web',localizedName={},count=1)],categories=[dict(id='landing',name='Landing',localizedName={},count=1)],mode_categories=[dict(mode_id='web',category_id='landing')],resource_categories=[dict(kind='template',id='sample.bundle',mode_id='web',category_id='landing')])
outer['design/taxonomy.json']=encode(taxonomy)
catalog=dict(publisher_id=PUBLISHER,release_id=RELEASE,schema_version=1,digest_schema='design-content-v1',resources=entries,taxonomy=taxonomy)
outer['design/catalog.json']=encode(catalog)
design=dict(schema_version=1,digest_schema='design-content-v1',taxonomy=dict(path='design/taxonomy.json',sha256=sha(outer['design/taxonomy.json'])),**manifest_items)
manifest=dict(publisher_id=PUBLISHER,release_id=RELEASE,version=1,generated_at='2026-10-21T00:00:00Z',agent_resources=dict(skills=[],rules=[],connectors=[],experts=[]),design_resources=design,static_assets=[])
manifest_sha=sha(encode(manifest))
manifest['manifest_sha256']=manifest_sha
outer['manifest.json']=encode(manifest)
outer['release.json']=encode(dict(publisher=dict(id=PUBLISHER,name='fixture',version='1',url=''),release_id=RELEASE,version=1,manifest_sha256=manifest_sha))
outer['CHECKSUMS.sha256']=''.join(hashlib.sha256(b).hexdigest()+'  '+n+'\n' for n,b in sorted(outer.items())).encode()
ROOT.mkdir(parents=True,exist_ok=True)
(ROOT/'release.zip').write_bytes(archive(outer))
(ROOT/'catalog.json').write_bytes(encode(catalog)+b'\n')
vectors=[]
for v in [{'z':0,'a':'中文\n','n':-0.0}, {'\ue000':1,'\U0001f600':2,'a':[1,True,None]}, {'numbers':[1e30,1e-7,1e-6,333333333.3333333], 'escape':'<>&'}, {'null':None,'empty':{},'array':[]}]:
    b=canonical(v);vectors.append(dict(input=v,canonical=b.decode(),sha256=sha(b)))
(ROOT/'canonical.json').write_bytes(encode(vectors)+b'\n')
(ROOT/'SHA256SUMS').write_text(''.join(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()+'  '+n+'\n' for n in ['canonical.json','catalog.json','release.zip']))
print('已生成独立冻结夹具；变更时须与上游测试向量复核')
