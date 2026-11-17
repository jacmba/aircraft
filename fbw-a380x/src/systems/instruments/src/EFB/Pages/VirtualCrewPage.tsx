// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import React, { useState } from 'react';

import { usePersistentProperty, useSimVar } from '@flybywiresim/fbw-sdk-react';
import { SelectGroup, SelectInput, SelectItem, SettingItem, SettingsPage, Toggle } from '@flybywiresim/flypad';
import {
  VirtualCrewButtonEvents,
  VirtualCrewButtonLocalVars,
  VirtualCrewButtonNone,
  VirtualCrewDefaults,
  VirtualCrewSettingKeys,
  VirtualCrewVoices,
  VirtualCrewVoiceSetting,
} from '../../../../shared/src/VirtualCrew';

/** Names of the sim events as shown in the MSFS controls settings */
const ButtonEventLabels: Record<string, string> = {
  [VirtualCrewButtonNone]: 'None',
  SMOKE_TOGGLE: 'Toggle smoke system',
  TOGGLE_TAIL_HOOK_HANDLE: 'Toggle tail hook',
  TOGGLE_WING_FOLD: 'Toggle wing fold',
  TOGGLE_WATER_RUDDER: 'Toggle water rudders',
};

const buttonEventOptions = [VirtualCrewButtonNone, ...VirtualCrewButtonEvents].map((event) => ({
  value: event,
  displayValue: ButtonEventLabels[event] ?? event,
}));

const VoiceLabels: Record<VirtualCrewVoiceSetting, string> = {
  male: 'Male',
  female: 'Female',
};

const VoiceSelect: React.FC<{ value: string; onChange: (value: VirtualCrewVoiceSetting) => void }> = ({
  value,
  onChange,
}) => (
  <SelectGroup>
    {VirtualCrewVoices.map((voice) => (
      <SelectItem key={voice} onSelect={() => onChange(voice)} selected={value === voice}>
        {VoiceLabels[voice]}
      </SelectItem>
    ))}
  </SelectGroup>
);

/**
 * Creates a short beep as a WAV file (16 bit PCM, mono) in a data URI
 * @returns the data URI
 */
const createBeepWav = (): string => {
  const sampleRate = 22050;
  const samples = Math.round(sampleRate * 0.4);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) =>
    text.split('').forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 880 * i) / sampleRate) * 0.3 * 0x7fff, true);
  }

  let binary = '';
  new Uint8Array(buffer).forEach((byte) => (binary += String.fromCharCode(byte)));
  return `data:audio/wav;base64,${btoa(binary)}`;
};

/**
 * Checks whether the instruments can play audio files without Wwise (HTML audio of Coherent GT).
 * If they can, the voices of the virtual crew can be shipped as WAV files instead of a Wwise package.
 */
const AudioPlaybackTest: React.FC = () => {
  const [result, setResult] = useState<string>('');

  const test = () => {
    try {
      const audio = new Audio(createBeepWav());
      const played = audio.play() as Promise<void> | undefined;
      if (played && typeof played.then === 'function') {
        played
          .then(() => setResult('Playing: do you hear a beep?'))
          .catch((e) => setResult(`Failed: ${e?.message ?? e}`));
      } else {
        setResult('Started (no promise): do you hear a beep?');
      }
    } catch (e: any) {
      setResult(`Not supported: ${e?.message ?? e}`);
    }
  };

  return (
    <SettingItem name="Audio playback test (without Wwise)">
      <div className="flex flex-row items-center space-x-4">
        {result && <span className="text-xl text-theme-unselected">{result}</span>}
        <SelectGroup>
          <SelectItem onSelect={test}>Play beep</SelectItem>
        </SelectGroup>
      </div>
    </SettingItem>
  );
};

export const VirtualCrewPage: React.FC = () => {
  const [enabled, setEnabled] = usePersistentProperty(VirtualCrewSettingKeys.Enabled, VirtualCrewDefaults.enabled);
  const [captainVoice, setCaptainVoice] = usePersistentProperty(
    VirtualCrewSettingKeys.CaptainVoice,
    VirtualCrewDefaults.captainVoice,
  );
  const [firstOfficerVoice, setFirstOfficerVoice] = usePersistentProperty(
    VirtualCrewSettingKeys.FirstOfficerVoice,
    VirtualCrewDefaults.firstOfficerVoice,
  );
  const [primaryEvent, setPrimaryEvent] = usePersistentProperty(
    VirtualCrewSettingKeys.PrimaryButtonEvent,
    VirtualCrewDefaults.primaryButtonEvent,
  );
  const [secondaryEvent, setSecondaryEvent] = usePersistentProperty(
    VirtualCrewSettingKeys.SecondaryButtonEvent,
    VirtualCrewDefaults.secondaryButtonEvent,
  );
  const [, setPrimaryButton] = useSimVar(VirtualCrewButtonLocalVars.Primary, 'number');
  const [, setSecondaryButton] = useSimVar(VirtualCrewButtonLocalVars.Secondary, 'number');

  const isEnabled = enabled === '1';

  return (
    <SettingsPage name="Virtual Crew">
      <SettingItem name="Virtual crew">
        <Toggle value={isEnabled} onToggle={(value) => setEnabled(value ? '1' : '0')} />
      </SettingItem>

      <SettingItem name="Captain voice" disabled={!isEnabled}>
        <VoiceSelect value={captainVoice} onChange={setCaptainVoice} />
      </SettingItem>

      <SettingItem name="First officer voice" disabled={!isEnabled}>
        <VoiceSelect value={firstOfficerVoice} onChange={setFirstOfficerVoice} />
      </SettingItem>

      <SettingItem name="Primary button (sim event)" disabled={!isEnabled}>
        <SelectInput
          className="w-80"
          value={primaryEvent}
          onChange={(value) => setPrimaryEvent(value as string)}
          options={buttonEventOptions}
          disabled={!isEnabled}
        />
      </SettingItem>

      <SettingItem name="Secondary button (sim event)" disabled={!isEnabled}>
        <SelectInput
          className="w-80"
          value={secondaryEvent}
          onChange={(value) => setSecondaryEvent(value as string)}
          options={buttonEventOptions}
          disabled={!isEnabled}
        />
      </SettingItem>

      <SettingItem name="Press button" disabled={!isEnabled}>
        <SelectGroup>
          <SelectItem disabled={!isEnabled} onSelect={() => setPrimaryButton(1)}>
            Primary
          </SelectItem>
          <SelectItem disabled={!isEnabled} onSelect={() => setSecondaryButton(1)}>
            Secondary
          </SelectItem>
        </SelectGroup>
      </SettingItem>

      <AudioPlaybackTest />

      <div className="py-4 text-xl leading-relaxed text-theme-text">
        <p>
          You are the pilot flying, in the seat of the camera. The virtual crew member is the pilot monitoring and
          follows the FBW A380X SOP. Bind the selected sim events to buttons of your controller in the MSFS controls
          settings.
        </p>
        <p className="mt-2">
          Primary button: requests the available checklist and gives the responses to the checklist items, otherwise
          gives the next order of the pilot flying (e.g. "Takeoff", "Gear up", "Flaps one"). Secondary button: stops the
          checklist being read, "Stop" during the takeoff roll before V1, otherwise skips the pending order.
        </p>
      </div>
    </SettingsPage>
  );
};
