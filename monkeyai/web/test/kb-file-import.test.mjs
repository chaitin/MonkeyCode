import assert from 'node:assert/strict'
import test from 'node:test'
import { importKnowledgeFile, validateKnowledgeFile } from '../src/lib/kb-file-import.ts'
const signal = () => new AbortController().signal
const item = (name) => ({ file: new File(['data'], name), parentID: null, stage: 'uploading' })

test('retry after losing the first image upload response reuses its upload key', async () => {
  const state = item('photo.png'); state.modelID = 'vision'
  const keys = []
  const request = async (_, init) => {
    keys.push(init.body.get('upload_key'))
    if (keys.length === 1) throw Error('lost reply after commit')
    return { status: 'completed', document_id: 'saved' }
  }
  await assert.rejects(importKnowledgeFile(state, '/imports', request, signal(), () => {}), /lost reply/)
  await importKnowledgeFile(state, '/imports', request, signal(), () => {})
  assert.match(keys[0], /^[a-f0-9]{32}$/)
  assert.deepEqual(keys, [keys[0], keys[0]])
})

test('reject unsupported files and invalid image parameters before upload', async () => {
  assert.throws(() => validateKnowledgeFile({ name: 'old.DOC', size: 2 }), /importUnsupported/)
  assert.throws(() => validateKnowledgeFile({ name: 'a.pdf', size: 33 * 1024 * 1024 }), /importSize/)
  await assert.rejects(importKnowledgeFile(item('a.png'), '/imports', async () => { throw Error('unexpected') }, signal(), () => {}), /imageModelRequired/)
})
for (const ext of ['txt', 'html', 'csv']) test(`${ext} is saved by upload without body roundtrip`, async () => {
  const state = item(`file.${ext}`); state.parentID = 'folder'; const calls = []
  await importKnowledgeFile(state, '/imports', async (path, init) => {
    calls.push(path)
    assert.ok(init.body instanceof FormData)
    assert.equal(init.body.get('parent_id'), 'folder')
    assert.equal(init.body.get('title'), `file.${ext}`)
    return { status: 'completed', document_id: 'saved', import_context: 'original', file_type: ext }
  }, signal(), () => {})
  assert.deepEqual(calls, ['/imports/upload']); assert.equal(state.documentID, 'saved')
})
test('PDF polls and receives a saved document, never list/export/commit or body', async () => {
  const state = item('file.pdf'); let polls = 0; const calls = []
  await importKnowledgeFile(state, '/imports', async (path, init) => {
    calls.push(path)
    if (path.endsWith('/upload')) return { status: 'pending', task_context: 'task', import_context: 'original', file_type: 'pdf' }
    assert.equal(JSON.parse(init.body).task_context, 'task')
    return ++polls === 1 ? { status: 'pending' } : { status: 'completed', document_id: 'saved' }
  }, signal(), () => {}, 1)
  assert.deepEqual(calls, ['/imports/upload', '/imports/query', '/imports/query'])
  assert.equal(state.documentID, 'saved')
})
test('poll network failure retains task and recovers an already saved document', async () => {
  const state = item('file.pdf'); let uploads = 0; let queries = 0
  const request = async path => {
    if (path.endsWith('/upload')) { uploads++; return { status: 'pending', task_context: 'task', import_context: 'original', file_type: 'pdf' } }
    if (path.endsWith('/result')) return { exists: true, document_id: 'saved' }
    queries++; throw Error('lost reply')
  }
  await assert.rejects(importKnowledgeFile(state, '/imports', request, signal(), () => {}, 1), /lost reply/)
  assert.equal(state.task, 'task')
  await importKnowledgeFile(state, '/imports', request, signal(), () => {}, 1)
  assert.equal(uploads, 1); assert.equal(queries, 1); assert.equal(state.documentID, 'saved')
})
test('capacity retry reuses original reference rather than uploading file again', async () => {
  const state = item('file.pdf'); let uploads = 0
  await importKnowledgeFile(state, '/imports', async (path, init) => {
    if (path.endsWith('/query')) return { status: 'completed', document_id: 'saved' }
    uploads++
    if (uploads === 1) { assert.ok(init.body instanceof FormData); return { status: 'failed', retryable: true, import_context: 'original', file_type: 'pdf' } }
    assert.deepEqual(JSON.parse(init.body), { import_context: 'original', title: 'file.pdf', parent_id: null })
    return { status: 'pending', task_context: 'same-task' }
  }, signal(), () => {}, 1)
  assert.equal(uploads, 2); assert.equal(state.documentID, 'saved')
})
test('aborting after accepted upload never sends a result query', async () => {
  const state = item('file.pdf'); const controller = new AbortController(); const calls = []
  await assert.rejects(importKnowledgeFile(state, '/imports', async path => {
    calls.push(path); controller.abort()
    return { status: 'pending', task_context: 'task', import_context: 'original', file_type: 'pdf' }
  }, controller.signal, () => {}, 1), { name: 'AbortError' })
  assert.deepEqual(calls, ['/imports/upload']); assert.equal(state.documentID, undefined)
})
test('abort while pending stops further queries', async () => {
  const state = item('file.pdf'); const controller = new AbortController(); let queries = 0
  await assert.rejects(importKnowledgeFile(state, '/imports', async path => {
    if (path.endsWith('/upload')) return { status: 'pending', task_context: 'task' }
    queries++; controller.abort(); return { status: 'pending' }
  }, controller.signal, () => {}, 1), { name: 'AbortError' })
  assert.equal(queries, 1)
})
test('images send model on upload and never automatically replay a paid failure', async () => {
  const state = item('photo.JPEG'); state.modelID = 'vision'; let calls = 0
  await assert.rejects(importKnowledgeFile(state, '/imports', async (path, init) => {
    calls++; assert.equal(path, '/imports/upload'); assert.equal(init.body.get('model_id'), 'vision')
    return { status: 'failed', error: 'provider failed', retryable: true, import_context: 'original', file_type: 'jpg' }
  }, signal(), () => {}, 1), /provider failed/)
  assert.equal(calls, 1); assert.equal(state.upload.import_context, 'original')
})
test('image retry checks saved document before re-parsing', async () => {
  const state = item('photo.png'); state.modelID = 'vision'; state.upload = { import_context: 'original', file_type: 'png' }
  await importKnowledgeFile(state, '/imports', async path => {
    assert.equal(path, '/imports/result'); return { exists: true, document_id: 'already-saved' }
  }, signal(), () => {})
  assert.equal(state.documentID, 'already-saved')
})
test('expired polling budget makes no requests', async () => {
  const state = item('file.pdf'); state.startedAt = Date.now() - 31 * 60 * 1000
  await assert.rejects(importKnowledgeFile(state, '/imports', async () => { throw Error('unexpected') }, signal(), () => {}), /importTimeout/)
})

test('uncertain submission retains context and retries without reuploading bytes', async () => {
  const state = item('file.pdf'); const calls = []
  await importKnowledgeFile(state, '/imports', async (path, init) => {
    calls.push(path)
    if (calls.length === 1) {
      assert.ok(init.body instanceof FormData)
      return { status: 'failed', retryable: true, error: 'anydoc 请求结果不确定', import_context: 'same-original-and-id', file_type: 'pdf' }
    }
    if (path.endsWith('/upload')) {
      assert.equal(JSON.parse(init.body).import_context, 'same-original-and-id')
      return { status: 'pending', task_context: 'retained-task' }
    }
    assert.equal(JSON.parse(init.body).task_context, 'retained-task')
    return { status: 'completed', document_id: 'original-document-id' }
  }, signal(), () => {}, 1)
  assert.deepEqual(calls, ['/imports/upload', '/imports/upload', '/imports/query'])
  assert.equal(state.documentID, 'original-document-id')
})

for (const retryable of [undefined, false]) test(`uncertain text save retains identity when retryable=${retryable}`, async () => {
  const state = item('file.txt')
  let uploads = 0
  const request = async path => {
    if (path.endsWith('/result')) return { exists: true, document_id: 'committed' }
    uploads++
    return { status: 'failed', retryable, import_context: 'original', file_type: 'txt', error: 'read after commit failed' }
  }
  await assert.rejects(importKnowledgeFile(state, '/imports', request, signal(), () => {}), /read after commit/)
  assert.ok(state.uploadKey)
  assert.equal(state.upload.import_context, 'original')
  await importKnowledgeFile(state, '/imports', request, signal(), () => {})
  assert.equal(uploads, 1)
  assert.equal(state.documentID, 'committed')
})

test('explicit terminal conversion failure permits a new upload identity', async () => {
  const state = item('file.pdf')
  state.uploadKey = 'original-key'
  state.upload = { import_context: 'original', file_type: 'pdf' }
  state.task = 'task'
  await assert.rejects(importKnowledgeFile(state, '/imports', async path => {
    if (path.endsWith('/result')) return { exists: false }
    return { status: 'failed', restart_required: true, error: 'terminal failure' }
  }, signal(), () => {}), /terminal failure/)
  assert.equal(state.uploadKey, undefined)
  assert.equal(state.upload, undefined)
  assert.equal(state.task, undefined)
})

test('local timeout retains original identity for reconciliation', async () => {
  const state = item('file.pdf')
  state.uploadKey = 'original-key'
  state.upload = { import_context: 'original', file_type: 'pdf' }
  state.task = 'expired-task'
  state.startedAt = Date.now() - 31 * 60 * 1000
  await assert.rejects(importKnowledgeFile(state, '/imports', async () => { throw Error('unexpected request') }, signal(), () => {}), /importTimeout/)
  assert.equal(state.uploadKey, 'original-key')
  assert.equal(state.upload.import_context, 'original')
  assert.equal(state.task, undefined)
  await importKnowledgeFile(state, '/imports', async path => {
    assert.equal(path, '/imports/result')
    return { exists: true, document_id: 'committed' }
  }, signal(), () => {})
  assert.equal(state.documentID, 'committed')
})
