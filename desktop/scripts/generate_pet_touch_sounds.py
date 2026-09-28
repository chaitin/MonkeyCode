"""Generate original, short toy squeaks for pet press/release (no external samples)."""
import math
from pathlib import Path
import struct
import wave

OUTPUT = Path(__file__).resolve().parents[1] / "ui-next" / "public"
RATE = 44100


def squeak(name, duration, start, end):
    phase = 0.0
    samples = []
    count = round(duration * RATE)
    for index in range(count):
        progress = index / (count - 1)
        # Smooth chirp, quiet harmonics and a zero-ended envelope avoid clicks.
        frequency = start + (end - start) * math.sin(progress * math.pi / 2)
        phase += math.tau * frequency / RATE
        envelope = math.sin(math.pi * progress) ** 1.7
        tone = math.sin(phase) + 0.22 * math.sin(2 * phase) + 0.08 * math.sin(3 * phase)
        samples.append(round(32767 * 0.30 * envelope * tone))
    with wave.open(str(OUTPUT / name), "wb") as audio:
        audio.setparams((1, 2, RATE, count, "NONE", "not compressed"))
        audio.writeframes(struct.pack(f"<{count}h", *samples))


if __name__ == "__main__":
    squeak("sound-pet-press.wav", 0.12, 640, 390)
    squeak("sound-pet-release.wav", 0.19, 480, 920)

    squeak("sound-pet-soft-press.wav", 0.055, 300, 180)
    squeak("sound-pet-soft-release.wav", 0.085, 430, 600)
    squeak("sound-pet-bell.wav", 0.22, 880, 880)
