import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatInputSource = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
);
const uploadSource = readFileSync(
  new URL("../src/components/console/task/task-file-upload.tsx", import.meta.url),
  "utf8",
);

test("任务图片附件在实际上传阶段按规则压缩", () => {
  assert.match(uploadSource, /const IMAGE_COMPRESS_MIN_SIZE_BYTES = 200 \* 1024/);
  assert.match(uploadSource, /const IMAGE_COMPRESS_QUALITY = 0\.6/);
  assert.match(uploadSource, /const IMAGE_COMPRESS_OUTPUT_TYPE = "image\/webp"/);
  assert.match(uploadSource, /"image\/jpeg"/);
  assert.match(uploadSource, /"image\/png"/);
  assert.match(uploadSource, /"image\/webp"/);
  assert.match(uploadSource, /"image\/bmp"/);
  assert.match(uploadSource, /"image\/avif"/);
  assert.doesNotMatch(uploadSource, /IMAGE_COMPRESS_TYPES[\s\S]*"image\/gif"/);
  assert.doesNotMatch(uploadSource, /IMAGE_COMPRESS_TYPES[\s\S]*"image\/svg\+xml"/);
  assert.match(uploadSource, /const IMAGE_COMPRESS_EXTENSIONS = new Set/);
  assert.match(uploadSource, /"jpg"/);
  assert.match(uploadSource, /"jpeg"/);
  assert.match(uploadSource, /"png"/);
  assert.match(uploadSource, /"webp"/);
  assert.match(uploadSource, /"bmp"/);
  assert.match(uploadSource, /"avif"/);
  assert.doesNotMatch(uploadSource, /IMAGE_COMPRESS_EXTENSIONS[\s\S]*"gif"/);
  assert.doesNotMatch(uploadSource, /IMAGE_COMPRESS_EXTENSIONS[\s\S]*"svg"/);

  assert.match(uploadSource, /const compressImageFileIfNeeded = async \(file: File\)/);
  assert.match(uploadSource, /const isCompressibleImageFile = \(file: File\)/);
  assert.match(uploadSource, /IMAGE_COMPRESS_TYPES\.has\(file\.type\.toLowerCase\(\)\)/);
  assert.match(uploadSource, /IMAGE_COMPRESS_EXTENSIONS\.has\(extensionMatch\[1\]\.toLowerCase\(\)\)/);
  assert.match(uploadSource, /file\.size < IMAGE_COMPRESS_MIN_SIZE_BYTES/);
  assert.match(uploadSource, /canvas\.toBlob\([\s\S]*IMAGE_COMPRESS_OUTPUT_TYPE,[\s\S]*IMAGE_COMPRESS_QUALITY/);
  assert.match(uploadSource, /replaceFileExtension\(file\.name, "webp"\)/);
  assert.match(uploadSource, /compressedFile\.size >= file\.size/);
  assert.match(uploadSource, /const uploadFile = await compressImageFileIfNeeded\(file\)/);
  assert.match(uploadSource, /if \(uploadFile\.size > MAX_TASK_UPLOAD_FILE_SIZE_BYTES\)/);
  assert.match(uploadSource, /throw new TaskUploadFileTooLargeError\(\)/);
  assert.match(uploadSource, /uploadFileWithPresignedUrl\(uploadFile\)/);
  assert.match(uploadSource, /name: uploadFile\.name/);
  assert.match(uploadSource, /size: uploadFile\.size/);
  assert.match(uploadSource, /type: uploadFile\.type/);
  assert.match(uploadSource, /error instanceof TaskUploadFileTooLargeError/);

  assert.doesNotMatch(chatInputSource, /compressImageFileIfNeeded/);
  assert.doesNotMatch(chatInputSource, /await compressImageFileIfNeeded/);
  assert.match(chatInputSource, /const prepareUploadFile = \(file: File/);
  assert.match(chatInputSource, /const normalizedFile = normalizeUploadFile\(file\)/);
  assert.match(chatInputSource, /const uploadFile = addCurrentRoundFileIndex\(normalizedFile\)/);
  assert.match(chatInputSource, /uploadFile\.size > MAX_TASK_UPLOAD_FILE_SIZE_BYTES && !isCompressibleImageFile\(uploadFile\)/);
  assert.match(chatInputSource, /void prepareUploadFile\(file\)/);
  assert.match(chatInputSource, /void prepareUploadFile\(files\[0\], \{ autoUpload: true \}\)/);
});
