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

/**
 * Flight phases of the virtual crew, one per chapter of the FBW A380X SOP (3 DEC 2021).
 * The values are published in {@link VirtualCrewStatusLocalVars.Phase}, do not change them.
 */
export enum VirtualCrewFlightPhase {
  /** No flight in progress */
  Idle = 0,
  /** SOP "Preliminary Cockpit Preparation" and "Cockpit Preparation" up to the takeoff briefing (p. 3-18) */
  Preflight = 1,
  /** SOP "Takeoff Briefing" (p. 18) */
  TakeoffBriefing = 2,
  /** SOP "Before Pushback or Start" (p. 20) */
  BeforeStart = 3,
  /** SOP "Engine Start" (p. 25) */
  EngineStart = 4,
  /** SOP "After Start" (p. 27) */
  AfterStart = 5,
  /** SOP "Taxi" (p. 30) */
  Taxi = 6,
  /** SOP "Before Takeoff" (p. 35) */
  BeforeTakeoff = 7,
  /** SOP "Takeoff" (p. 38) */
  Takeoff = 8,
  /** SOP "After Takeoff" (p. 42) */
  AfterTakeoff = 9,
  /** SOP "Climb" (p. 44) */
  Climb = 10,
  /** SOP "Cruise" (p. 47) */
  Cruise = 11,
  /** SOP "Descent Preparation" (p. 49) */
  DescentPreparation = 12,
  /** SOP "Descent" (p. 53) */
  Descent = 13,
  /** SOP "Precision Approach", "Non Precision Approach", "Visual Approach" (p. 56-67) */
  Approach = 14,
  /** SOP "Landing" (p. 68) */
  Landing = 15,
  /** SOP "Go-Around" (p. 69) */
  GoAround = 16,
  /** SOP "After Landing" (p. 72) */
  AfterLanding = 17,
  /** SOP "Parking" (p. 75) */
  Parking = 18,
  /** SOP "Securing the aircraft" (p. 78) */
  Securing = 19,
}

export const VirtualCrewFlightPhaseNames: Record<VirtualCrewFlightPhase, string> = {
  [VirtualCrewFlightPhase.Idle]: 'No flight in progress',
  [VirtualCrewFlightPhase.Preflight]: 'Preflight',
  [VirtualCrewFlightPhase.TakeoffBriefing]: 'Takeoff briefing',
  [VirtualCrewFlightPhase.BeforeStart]: 'Before pushback or start',
  [VirtualCrewFlightPhase.EngineStart]: 'Engine start',
  [VirtualCrewFlightPhase.AfterStart]: 'After start',
  [VirtualCrewFlightPhase.Taxi]: 'Taxi',
  [VirtualCrewFlightPhase.BeforeTakeoff]: 'Before takeoff',
  [VirtualCrewFlightPhase.Takeoff]: 'Takeoff',
  [VirtualCrewFlightPhase.AfterTakeoff]: 'After takeoff',
  [VirtualCrewFlightPhase.Climb]: 'Climb',
  [VirtualCrewFlightPhase.Cruise]: 'Cruise',
  [VirtualCrewFlightPhase.DescentPreparation]: 'Descent preparation',
  [VirtualCrewFlightPhase.Descent]: 'Descent',
  [VirtualCrewFlightPhase.Approach]: 'Approach',
  [VirtualCrewFlightPhase.Landing]: 'Landing',
  [VirtualCrewFlightPhase.GoAround]: 'Go-around',
  [VirtualCrewFlightPhase.AfterLanding]: 'After landing',
  [VirtualCrewFlightPhase.Parking]: 'Parking',
  [VirtualCrewFlightPhase.Securing]: 'Securing the aircraft',
};

/** Duration of the preflight phase, in seconds */
export const VIRTUAL_CREW_PREFLIGHT_DURATION_S = 40 * 60;

/** Speed factor of the preflight countdown when accelerated */
export const VIRTUAL_CREW_PREFLIGHT_ACCELERATION = 30;

/**
 * Commands of the flyPad to the virtual crew, written to {@link VirtualCrewCommandLocalVar}.
 * The virtual crew resets the variable to {@link VirtualCrewCommand.None} once processed.
 */
export enum VirtualCrewCommand {
  None = 0,
  /** Starts the preflight phase */
  StartPreflight = 1,
  /** Starts the takeoff briefing, skipping the preflight */
  StartTakeoffBriefing = 2,
  /** Toggles the acceleration of the preflight countdown, only possible while no workflow is running */
  ToggleAcceleration = 3,
  /** The pilot flying has performed the takeoff briefing */
  CompleteTakeoffBriefing = 4,
  /** Ends the current flight */
  Reset = 5,
}

export const VirtualCrewCommandLocalVar = 'L:A380X_VCREW_COMMAND';

/** State of the virtual crew, published for the flyPad */
export const VirtualCrewStatusLocalVars = {
  /** {@link VirtualCrewFlightPhase} */
  Phase: 'L:A380X_VCREW_PHASE',
  /** Remaining time of the preflight phase, in seconds */
  PreflightRemaining: 'L:A380X_VCREW_PREFLIGHT_REMAINING',
  /** 1 if the preflight countdown is accelerated */
  Accelerated: 'L:A380X_VCREW_ACCELERATED',
  /** Index in {@link VirtualCrewWorkflows} + 1 of the running workflow, 0 if none */
  Workflow: 'L:A380X_VCREW_WORKFLOW',
} as const;

/** Workflows of the virtual crew, the order defines the value of {@link VirtualCrewStatusLocalVars.Workflow} */
export const VirtualCrewWorkflows = [{ id: 'initialPowerUp', name: 'Initial power up', seat: 'FO' }] as const;

/**
 * Data of the takeoff briefing which is not available from the FMGS, entered in the flyPad.
 * The values are stored per flight and cleared when the flight is ended in the flyPad.
 */
export const VirtualCrewBriefingFields = [
  { key: 'A380X_VCREW_BRIEFING_ATIS', label: 'ATIS information', placeholder: 'e.g. K' },
  { key: 'A380X_VCREW_BRIEFING_RWY_COND', label: 'Runway condition', placeholder: 'e.g. DRY, WET' },
  { key: 'A380X_VCREW_BRIEFING_TAXI', label: 'Taxi route', placeholder: 'e.g. A B5 holding point 27R' },
  { key: 'A380X_VCREW_BRIEFING_CLEARED_ALT', label: 'Cleared initial altitude', placeholder: 'e.g. 6000 ft' },
  { key: 'A380X_VCREW_BRIEFING_SQUAWK', label: 'Squawk', placeholder: 'e.g. 4721' },
  { key: 'A380X_VCREW_BRIEFING_DEP_FREQ', label: 'Departure frequency', placeholder: 'e.g. 125.800' },
  { key: 'A380X_VCREW_BRIEFING_EO_PROC', label: 'Engine failure procedure', placeholder: 'e.g. EOSID, straight ahead' },
  { key: 'A380X_VCREW_BRIEFING_THREATS', label: 'Threats / remarks', placeholder: 'e.g. heavy traffic, MEL items' },
] as const;
