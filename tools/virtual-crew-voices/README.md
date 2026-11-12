# A380X virtual crew voices

Generates the phrases of the A380X virtual crew (`fbw-a380x/src/systems/extras-host/modules/virtual_crew`) with
the [Piper](https://github.com/OHF-Voice/piper1-gpl) speech synthesiser.

## Phrases and voices

The phrases are defined once in `voice-lines.json` of the virtual crew module. Each phrase is generated for every
voice:

| Voice  | Piper model             | Training data license |
|--------|-------------------------|-----------------------|
| male   | `en_US-joe-medium`      | CC0                   |
| female | `en_US-kristin-medium`  | Public domain         |

Only models whose training data allows the redistribution of the generated audio are used. Several popular Piper
voices (e.g. `ryan`, `hfc_male`, `hfc_female`) are trained on non-commercial (CC BY-NC-SA) data and must not be used.

## Generating

```sh
python3 -m venv .venv
.venv/bin/pip install -r tools/virtual-crew-voices/requirements.txt
.venv/bin/python tools/virtual-crew-voices/generate_voices.py
```

The script downloads the models on first use (to `build/piper-models`) and writes:

- `build/virtual-crew-voices/<voice>/vcrew_<voice>_<phrase>.wav`, one file per voice and phrase
- `build/virtual-crew-voices/sound-xml-entries.xml`, the `<AvionicSounds>` entries for `sound.xml`
- `voice-line-durations.json` in the virtual crew module, used to play the phrases one after the other.
  Commit it whenever the phrases change.

## Packaging for MSFS

The virtual crew plays the phrases with `PLAY_INSTRUMENT_SOUND`, which requires a Wwise event per phrase:

1. In Wwise Authoring (the version matching the MSFS SDK), import the WAV files as sounds and create one *Play* event
   per sound, named like the file without extension (e.g. `vcrew_male_v_1`).
2. Add the events to a sound bank and generate the package `FBW_A380X_VCREW` with the MSFS SDK sound tools.
3. Add the package to the `large-files` submodule and reference it in
   `fbw-a380x/src/base/.../FlyByWire_A380X/common/sound/sound.xml`:
   - `<AdditionalPackage Name="FBW_A380X_VCREW" />` in `<WwisePackages>`
   - the content of `sound-xml-entries.xml` in `<AvionicSounds>`

Until the package exists, the virtual crew runs (actions and logic) but stays silent.
