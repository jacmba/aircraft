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
  | { type: 'GEAR_DOWN' }
  | { type: 'FLAPS_SET'; index: number }
  /** Sets a local variable, e.g. to push a pushbutton of the overhead panel */
  | { type: 'SET_LOCAL_VAR'; name: string; value: number }
  /** Presses a momentary pushbutton: the local variable is set to 1, then back to 0 */
  | { type: 'PULSE_LOCAL_VAR'; name: string }
  /** Triggers a simulator or aircraft event, e.g. 'A32NX.FCU_FD_PUSH' (without the K: prefix) */
  | { type: 'KEY_EVENT'; name: string; value?: number }
  /** Publishes an event on the synced event bus, e.g. a setting of the MFD SURV page */
  | { type: 'BUS_EVENT'; topic: string; value: boolean | number }
  /** Sets the seat belts signs, only toggled if not in the requested position */
  | { type: 'SEAT_BELTS'; on: boolean };

/** Reads a simulator variable, e.g. 'L:A32NX_EXT_PWR_AVAIL:1' */
export type SimVarReader = (name: string) => number;

/** A phrase spoken by a crew member */
export interface CrewSpeech {
  role: CrewRole;
  line: VoiceLineId;
  /**
   * Pause after the phrase, in milliseconds, the default pause between phrases if not defined. A short pause chains
   * the parts of a composed sentence, e.g. "engine" "two" "stable".
   */
  pauseAfterMs?: number;
}

/** Everything the crew does as a result of an update or an input */
export interface CrewOutput {
  speech: CrewSpeech[];
  actions: CrewAction[];
}

/** Flight phase of the FMGC (L:A32NX_FMGC_FLIGHT_PHASE) */
export enum FmgcPhase {
  Preflight = 0,
  Takeoff = 1,
  Climb = 2,
  Cruise = 3,
  Descent = 4,
  Approach = 5,
  GoAround = 6,
  Done = 7,
}

/** State of an engine as perceived by the crew */
export interface EngineSnapshot {
  /** 0 off, 1 on (running), 2 starting, 3 restarting, 4 shutting down (L:A32NX_ENGINE_STATE) */
  state: number;
  starterValveOpen: boolean;
  /** Fuel flow, 0 when no fuel is delivered */
  fuelFlow: number;
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

  /** Pressure altitude as indicated, in feet. Optional for the takeoff procedure. */
  altitude?: number;
  /** Magnetic heading, in degrees */
  heading?: number;
  fmgcPhase?: FmgcPhase;
  parkingBrakeSet?: boolean;
  groundSpoilersArmed?: boolean;
  /** Ground spoilers extended (speed brake lever fully extended) */
  groundSpoilersExtended?: boolean;
  /** Thrust reversers of the engines 2 and 3 deployed */
  reversersDeployed?: boolean;
  /** Deceleration of the autobrake reached */
  autobrakeDecel?: boolean;
  /** Engine mode selector in IGN START (any engine) */
  engineModeSelectorStart?: boolean;
  engines?: EngineSnapshot[];
  /** VFE of the next flaps position, 0 if not available */
  vfeNext?: number;
  /** Approach speed of the FMS, 0 if not available */
  vapp?: number;
  /** Altitude selected on the FCU */
  fcuAltitude?: number;
  /** Localizer received, deviation in dots (undefined if not received) */
  localizerDots?: number;
  /** Glideslope received, deviation in dots (undefined if not received) */
  glideslopeDots?: number;
  /** Flaps lever position for landing of the approach briefing: 3 or 4 (FULL) */
  briefedLandingFlaps?: number;
  /** Brake pedals of the pilot flying (0 to 100) and pressure of the alternate brakes (psi) */
  brakes?: { left: number; right: number; alternatePressure: number };
  /** Sidestick and rudder pedals of the pilot flying, -1 to 1 */
  flightControls?: { pitch: number; roll: number; rudder: number };
}
