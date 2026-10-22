import assert from "node:assert/strict"
import test from "node:test"

import { VIDEO_MODELS, videoDefaults, videoResolutions } from "../src/lib/video-models.ts"

const capability = {
  modes: ["text_to_video", "image_to_video", "first_last_to_video", "reference_image_to_video"],
  params: [
    { name: "resolution", type: "string", choices: ["480p", "720p", "1080p"] },
    { name: "aspect_ratio", type: "string", choices: ["adaptive", "16:9", "9:16"] },
    { name: "duration_seconds", type: "integer", min: 4, max: 30 },
    { name: "generate_audio", type: "boolean", choices: [true, false] },
  ],
  param_rules: [{ when: { modes: ["image_to_video", "first_last_to_video"] }, name: "aspect_ratio", choices: ["adaptive"] }],
}

test("Seedance versions have unique model choices under the same provider", () => {
  assert.equal(new Set(VIDEO_MODELS.map((entry) => entry.model)).size, VIDEO_MODELS.length)
  assert.deepEqual(VIDEO_MODELS.filter((entry) => entry.provider === "volcengine").map((entry) => entry.model), [
    "doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628",
  ])
})

test("video defaults retain boolean false and 30-second duration", () => {
  const saved = { modes: ["image_to_video"], defaults: { image_to_video: {
    resolution: "1080p", aspect_ratio: "16:9", duration_seconds: 30, generate_audio: false,
  } } }
  assert.deepEqual(videoDefaults(capability, saved.modes, saved), { image_to_video: {
    resolution: "1080p", aspect_ratio: "adaptive", duration_seconds: 30, generate_audio: false,
  } })
  assert.deepEqual(videoResolutions(capability), ["480p", "720p", "1080p"])
})

test("switching Seedance versions replaces unsupported defaults", () => {
  const seedance20 = { ...capability, params: capability.params.map((param) =>
    param.name === "resolution" ? { ...param, choices: ["480p", "720p", "1080p", "4k"] }
      : param.name === "duration_seconds" ? { ...param, max: 15 } : param) }
  const saved = { modes: ["text_to_video"], defaults: { text_to_video: {
    resolution: "4k", aspect_ratio: "16:9", duration_seconds: 30, generate_audio: "false",
  } } }
  const defaults20 = videoDefaults(seedance20, saved.modes, saved)
  assert.equal(defaults20.text_to_video.duration_seconds, 4)
  assert.equal(defaults20.text_to_video.resolution, "4k")
  assert.equal(defaults20.text_to_video.generate_audio, true)
  const defaults25 = videoDefaults(capability, saved.modes, saved)
  assert.equal(defaults25.text_to_video.resolution, "480p")
  assert.equal(defaults25.text_to_video.duration_seconds, 30)
})
