// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import voiceLines from './voice-lines.json';

/** Role of a crew member in the current flight, as defined by the SOP */
export type CrewRole = 'PF' | 'PM';

/** Seat occupied by a crew member */
export type CrewSeat = 'CAPT' | 'FO';

/** Gender of a synthesised voice */
export type CrewVoice = 'male' | 'female';

/** Identifier of a phrase of the virtual crew, see voice-lines.json */
export type VoiceLineId = keyof typeof voiceLines.lines;

/** Inputs given by the pilot flying in the button mode */
export type CrewInput = 'PRIMARY' | 'SECONDARY';

/** Actions performed by the virtual pilot monitoring on the aircraft */
export type CrewAction =
  | { type: 'GEAR_UP' }
  | { type: 'FLAPS_SET'; index: number }
  /** Sets a local variable, e.g. to push a pushbutton of the overhead panel */
  | { type: 'SET_LOCAL_VAR'; name: string; value: number };

/** Reads a simulator variable, e.g. 'L:A32NX_EXT_PWR_AVAIL:1' */
export type SimVarReader = (name: string) => number;

/** A phrase spoken by a crew member */
export interface CrewSpeech {
  role: CrewRole;
  line: VoiceLineId;
}

/** Everything the crew does as a result of an update or an input */
export interface CrewOutput {
  speech: CrewSpeech[];
  actions: CrewAction[];
}

/** Aircraft state as perceived by the crew, all speeds in knots, altitudes in feet, vertical speed in ft/min */
export interface AircraftSnapshot {
  onGround: boolean;
  indicatedAirspeed: number;
  groundSpeed: number;
  radioAltitude: number;
  verticalSpeed: number;
  /** V1 inserted in the FMS, 0 if not available */
  v1: number;
  /** VR inserted in the FMS, 0 if not available */
  vr: number;
  /** F speed, 0 if not available */
  fSpeed: number;
  /** S speed, 0 if not available */
  sSpeed: number;
  /** True if every thrust lever is at least in the FLX/MCT detent */
  thrustLeversInTakeoffPosition: boolean;
  /** True if the landing gear lever is up */
  gearLeverUp: boolean;
  /** Flaps lever position, 0 = flaps 0, 1 = flaps 1 (1+F), 2, 3, 4 = FULL */
  flapsLeverIndex: number;
}
