const encoder = new TextEncoder()
// bit 3 stores sizes and CRC after streamed file data; bit 11 marks UTF-8 paths.
const utf8DescriptorFlags = 0x0808

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
  }
  return value >>> 0
})

function updateCRC(previous: number, data: Uint8Array) {
  let crc = previous
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return crc >>> 0
}

function localHeader(nameLength: number) {
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, utf8DescriptorFlags, true)
  view.setUint16(26, nameLength, true)
  return bytes
}

function dataDescriptor(crc: number, size: number) {
  const bytes = new Uint8Array(16)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x08074b50, true)
  view.setUint32(4, crc, true)
  view.setUint32(8, size, true)
  view.setUint32(12, size, true)
  return bytes
}

function centralHeader(nameLength: number, size: number, crc: number, offset: number) {
  const bytes = new Uint8Array(46)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, utf8DescriptorFlags, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, size, true)
  view.setUint32(24, size, true)
  view.setUint16(28, nameLength, true)
  view.setUint32(42, offset, true)
  return bytes
}

function endOfDirectory(count: number, size: number, offset: number) {
  const bytes = new Uint8Array(22)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, count, true)
  view.setUint16(10, count, true)
  view.setUint32(12, size, true)
  view.setUint32(16, offset, true)
  return bytes
}

export async function stageDirectoryZip(files: Map<string, File>, maxBytes: number) {
  if (!navigator.storage?.getDirectory) throw new Error("当前浏览器不支持大目录磁盘暂存，请选择现成 ZIP")
  const root = await navigator.storage.getDirectory()
  const name = `resource-import-${crypto.randomUUID()}.zip`
  const handle = await root.getFileHandle(name, { create: true })
  const writer = await handle.createWritable()
  let offset = 0
  const write = async (chunk: Uint8Array) => {
    if (offset + chunk.byteLength > maxBytes) throw new Error("资源包超过 2 GiB")
    await writer.write(new Uint8Array(chunk))
    offset += chunk.byteLength
  }
  const entries: { name: Uint8Array; size: number; crc: number; offset: number }[] = []

  try {
    for (const [path, file] of files) {
      const encoded = encoder.encode(path)
      if (encoded.length > 0xffff || file.size > maxBytes) throw new Error("目录中存在超限文件或路径")
      const start = offset
      await write(localHeader(encoded.length))
      await write(encoded)
      let crc = 0xffffffff
      let length = 0
      const reader = file.stream().getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          crc = updateCRC(crc, value)
          length += value.byteLength
          await write(value)
        }
      } finally {
        reader.releaseLock()
      }
      if (length !== file.size) throw new Error(`目录文件读取不完整：${path}`)
      crc = (crc ^ 0xffffffff) >>> 0
      await write(dataDescriptor(crc, length))
      entries.push({ name: encoded, size: length, crc, offset: start })
    }
    const centralOffset = offset
    for (const entry of entries) {
      await write(centralHeader(entry.name.length, entry.size, entry.crc, entry.offset))
      await write(entry.name)
    }
    await write(endOfDirectory(entries.length, offset - centralOffset, centralOffset))
    await writer.close()
    return { file: await handle.getFile(), cleanup: () => root.removeEntry(name) }
  } catch (error) {
    await writer.abort().catch(() => {})
    await root.removeEntry(name).catch(() => {})
    throw error
  }
}
