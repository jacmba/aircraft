// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

/** Persistent settings of the virtual crew, shared by the flyPad and the extras host */
export const VirtualCrewSettingKeys = {
  /** '1' if the virtual crew is active */
  Enabled: 'CONFIG_A380X_VCREW_ENABLED',
  /** Voice of the captain, see {@link VirtualCrewVoices} */
  CaptainVoice: 'CONFIG_A380X_VCREW_CAPT_VOICE',
  /** Voice of the first officer, see {@link VirtualCrewVoices} */
  FirstOfficerVoice: 'CONFIG_A380X_VCREW_FO_VOICE',
  /** Sim event used as primary button, see {@link VirtualCrewButtonEvents} */
  PrimaryButtonEvent: 'CONFIG_A380X_VCREW_PRIMARY_EVENT',
  /** Sim event used as secondary button, see {@link VirtualCrewButtonEvents} */
  SecondaryButtonEvent: 'CONFIG_A380X_VCREW_SECONDARY_EVENT',
} as const;

export const VirtualCrewVoices = ['male', 'female'] as const;

export type VirtualCrewVoiceSetting = (typeof VirtualCrewVoices)[number];

/**
 * Sim events which can be bound to a joystick button in the MSFS controls and are used as buttons of the virtual crew.
 * They have no function in the A380X, the virtual crew intercepts them.
 */
export const VirtualCrewButtonEvents = [
  'SMOKE_TOGGLE',
  'TOGGLE_TAIL_HOOK_HANDLE',
  'TOGGLE_WING_FOLD',
  'TOGGLE_WATER_RUDDER',
] as const;

export type VirtualCrewButtonEvent = (typeof VirtualCrewButtonEvents)[number];

export const VirtualCrewButtonNone = 'NONE';

export const VirtualCrewDefaults = {
  enabled: '0',
  captainVoice: 'male' as VirtualCrewVoiceSetting,
  firstOfficerVoice: 'female' as VirtualCrewVoiceSetting,
  primaryButtonEvent: VirtualCrewButtonNone,
  secondaryButtonEvent: VirtualCrewButtonNone,
};

/**
 * Local variables acting as buttons of the virtual crew, for the flyPad and external tools (e.g. SPAD.neXt, AAO).
 * Writing 1 presses the button, the virtual crew resets the variable to 0.
 */
export const VirtualCrewButtonLocalVars = {
  Primary: 'L:A380X_VCREW_PRIMARY_BUTTON',
  Secondary: 'L:A380X_VCREW_SECONDARY_BUTTON',
} as const;
