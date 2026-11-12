#!/usr/bin/env python3
# Copyright (c) 2026 FlyByWire Simulations
# SPDX-License-Identifier: GPL-3.0
"""
Generates the voices of the A380X virtual crew with the Piper speech synthesiser.

The phrases are read from the catalogue of the virtual crew module (voice-lines.json). For every voice and phrase a
WAV file is written, named like the Wwise event which plays it (vcrew_<voice>_<line>.wav). The script also writes:

- the duration of every phrase into the module (voice-line-durations.json), used to queue the phrases
- the <AvionicSounds> entries for sound.xml (sound-xml-entries.xml in the output folder)

Usage:
    python3 -m venv .venv && .venv/bin/pip install -r tools/virtual-crew-voices/requirements.txt
    .venv/bin/python tools/virtual-crew-voices/generate_voices.py [--out build/virtual-crew-voices]

The Piper voice models are downloaded from huggingface.co on first use. Only voices whose training data allows the
redistribution of the generated audio are used, see VOICES below.
"""

import argparse
import json
import re
import urllib.request
import wave
from pathlib import Path

from piper import PiperVoice

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_DIR = REPO_ROOT / 'fbw-a380x' / 'src' / 'systems' / 'extras-host' / 'modules' / 'virtual_crew'
CATALOGUE = MODULE_DIR / 'voice-lines.json'
DURATIONS = MODULE_DIR / 'voice-line-durations.json'

MODEL_BASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

# voice of the catalogue -> Piper model, with the license of the training data
VOICES = {
    # https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/joe/medium/MODEL_CARD, dataset license CC0
    'male': 'en/en_US/joe/medium/en_US-joe-medium',
    # https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/kristin/medium/MODEL_CARD, public domain
    'female': 'en/en_US/kristin/medium/en_US-kristin-medium',
}


def event_name(voice: str, line: str) -> str:
    """Wwise event name of a phrase, must match wwiseEventName() in VoicePlayer.ts"""
    snake = re.sub(r'(?<!^)(?=[A-Z0-9])', '_', line).lower()
    return f'vcrew_{voice}_{snake}'


def download_model(model: str, cache: Path) -> Path:
    """Downloads a Piper model and its configuration if not cached yet"""
    cache.mkdir(parents=True, exist_ok=True)
    onnx = cache / (Path(model).name + '.onnx')
    for suffix in ('.onnx', '.onnx.json'):
        target = cache / (Path(model).name + suffix)
        if not target.exists():
            print(f'Downloading {model}{suffix}')
            urllib.request.urlretrieve(MODEL_BASE_URL + model + suffix, target)
    return onnx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', type=Path, default=REPO_ROOT / 'build' / 'virtual-crew-voices')
    parser.add_argument('--models', type=Path, default=REPO_ROOT / 'build' / 'piper-models')
    args = parser.parse_args()

    catalogue = json.loads(CATALOGUE.read_text(encoding='utf-8'))
    durations: dict[str, dict[str, int]] = {}
    sound_entries: list[str] = []

    for voice in catalogue['voices']:
        model = PiperVoice.load(str(download_model(VOICES[voice], args.models)))
        voice_dir = args.out / voice
        voice_dir.mkdir(parents=True, exist_ok=True)
        durations[voice] = {}

        for line, definition in catalogue['lines'].items():
            name = event_name(voice, line)
            path = voice_dir / f'{name}.wav'
            with wave.open(str(path), 'wb') as wav:
                model.synthesize_wav(definition['text'], wav)
            with wave.open(str(path), 'rb') as wav:
                durations[voice][line] = round(wav.getnframes() * 1000 / wav.getframerate())
            sound_entries.append(
                f'        <Sound WwiseData="true" WwiseEvent="{name}" NodeName="PEDALS_LEFT" ViewPoint="Inside" />'
            )
            print(f'{path.relative_to(args.out)}: {durations[voice][line]} ms')

    DURATIONS.write_text(json.dumps(durations, indent=2) + '\n', encoding='utf-8')
    (args.out / 'sound-xml-entries.xml').write_text('\n'.join(sound_entries) + '\n', encoding='utf-8')
    print(f'Durations written to {DURATIONS.relative_to(REPO_ROOT)}')
    print(f'sound.xml entries written to {args.out / "sound-xml-entries.xml"}')


if __name__ == '__main__':
    main()
