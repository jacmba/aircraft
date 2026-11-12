// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import React from 'react';

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

      <div className="py-4 text-xl leading-relaxed text-theme-text">
        <p>
          You are the pilot flying, in the seat of the camera. The virtual crew member is the pilot monitoring and
          follows the FBW A380X SOP. Bind the selected sim events to buttons of your controller in the MSFS controls
          settings.
        </p>
        <p className="mt-2">
          Primary button: next order of the pilot flying (e.g. "Takeoff", "Gear up", "Flaps one"). Secondary button:
          "Stop" during the takeoff roll before V1, otherwise skips the pending order.
        </p>
      </div>
    </SettingsPage>
  );
};
