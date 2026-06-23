import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatInputSource = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
);

test("任务输入框上传图片会在上传前按规则压缩", () => {
  assert.match(chatInputSource, /const IMAGE_COMPRESS_MIN_SIZE_BYTES = 200 \* 1024/);
  assert.match(chatInputSource, /const IMAGE_COMPRESS_QUALITY = 0\.6/);
  assert.match(chatInputSource, /const IMAGE_COMPRESS_OUTPUT_TYPE = "image\/webp"/);
  assert.match(chatInputSource, /"image\/jpeg"/);
  assert.match(chatInputSource, /"image\/png"/);
  assert.match(chatInputSource, /"image\/webp"/);
  assert.match(chatInputSource, /"image\/bmp"/);
  assert.match(chatInputSource, /"image\/avif"/);
  assert.doesNotMatch(chatInputSource, /IMAGE_COMPRESS_TYPES[\s\S]*"image\/gif"/);
  assert.doesNotMatch(chatInputSource, /IMAGE_COMPRESS_TYPES[\s\S]*"image\/svg\+xml"/);
  assert.match(chatInputSource, /const IMAGE_COMPRESS_EXTENSIONS = new Set/);
  assert.match(chatInputSource, /"jpg"/);
  assert.match(chatInputSource, /"jpeg"/);
  assert.match(chatInputSource, /"png"/);
  assert.match(chatInputSource, /"webp"/);
  assert.match(chatInputSource, /"bmp"/);
  assert.match(chatInputSource, /"avif"/);
  assert.doesNotMatch(chatInputSource, /IMAGE_COMPRESS_EXTENSIONS[\s\S]*"gif"/);
  assert.doesNotMatch(chatInputSource, /IMAGE_COMPRESS_EXTENSIONS[\s\S]*"svg"/);

  assert.match(chatInputSource, /const compressImageFileIfNeeded = async \(file: File\)/);
  assert.match(chatInputSource, /const isCompressibleImageFile = \(file: File\)/);
  assert.match(chatInputSource, /IMAGE_COMPRESS_TYPES\.has\(file\.type\.toLowerCase\(\)\)/);
  assert.match(chatInputSource, /IMAGE_COMPRESS_EXTENSIONS\.has\(extensionMatch\[1\]\.toLowerCase\(\)\)/);
  assert.match(chatInputSource, /file\.size < IMAGE_COMPRESS_MIN_SIZE_BYTES/);
  assert.match(chatInputSource, /canvas\.toBlob\([\s\S]*IMAGE_COMPRESS_OUTPUT_TYPE,[\s\S]*IMAGE_COMPRESS_QUALITY/);
  assert.match(chatInputSource, /replaceFileExtension\(file\.name, "webp"\)/);
  assert.match(chatInputSource, /compressedFile\.size >= file\.size/);

  assert.match(chatInputSource, /const prepareUploadFile = async \(file: File/);
  assert.match(chatInputSource, /const normalizedFile = normalizeUploadFile\(file\)/);
  assert.match(chatInputSource, /const compressedFile = await compressImageFileIfNeeded\(normalizedFile\)/);
  assert.match(chatInputSource, /const uploadFile = addCurrentRoundFileIndex\(compressedFile\)/);
  assert.match(chatInputSource, /void prepareUploadFile\(file\)/);
  assert.match(chatInputSource, /void prepareUploadFile\(files\[0\], \{ autoUpload: true \}\)/);
});
