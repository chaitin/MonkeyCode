import test from 'node:test'
import assert from 'node:assert/strict'
import {systemImages} from '../src/lib/system-images.ts'

test('上传传输完成不等于镜像已入库，等待服务端受理',async t=>{
  let xhr
  const old=globalThis.XMLHttpRequest
  t.after(()=>{if(old===undefined)delete globalThis.XMLHttpRequest;else globalThis.XMLHttpRequest=old})
  globalThis.XMLHttpRequest=class {upload={};constructor(){xhr=this}open(){}setRequestHeader(){}send(form){assert.equal(form.get('display_name'),'开发环境')}}
  const observed=[];let resolved=false
  const done=systemImages.upload('开发环境', new File(['test'],'test.tar'),'one',v=>observed.push(v)).then(value=>{resolved=true;return value})
  for(const loaded of [3,10])xhr.upload.onprogress({loaded,total:10,lengthComputable:true})
  await Promise.resolve();assert.deepEqual(observed,[30,100]);assert.equal(resolved,false)
  xhr.status=202;xhr.response={id:'one',status:'pending'};xhr.onload();assert.equal((await done).status,'pending')
})
