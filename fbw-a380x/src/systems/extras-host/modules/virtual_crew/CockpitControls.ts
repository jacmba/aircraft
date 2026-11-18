// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { VirtualCrewTestActionId } from '../../../shared/src/VirtualCrew';
import { CrewAction } from './VirtualCrewTypes';

/*
 * Cockpit controls operated by the virtual crew. The actions are those of the aircraft presets of the flyPad
 * (config/a380x/a380-842/aircraft_preset_procedures.xml), which operate the switches reliably, or the events of the
 * MFD SURV page for the transponder and the TCAS. They can be tested from the flyPad (Settings > Virtual Crew).
 */

/** L:LIGHTING_STROBE_0: 0 = ON, 1 = AUTO, 2 = OFF */
const STROBE_POSITIONS = { ON: 0, AUTO: 1, OFF: 2 } as const;

/** Index of the light circuits used with the light events */
const NOSE_LIGHT = 1;
const LANDING_LIGHTS = 2;
const RUNWAY_TURNOFF_LIGHTS = [2, 3];

/** L:A32NX_AUTOBRAKES_SELECTED_MODE, position of the autobrake selector */
export enum AutobrakeSelector {
  Disarm = 0,
  Btv = 1,
  Low = 2,
  L2 = 3,
  L3 = 4,
  High = 5,
}

/** L:A32NX_AUTOBRAKES_ARMED_MODE of the RTO mode */
export const AUTOBRAKE_ARMED_MODE_RTO = 6;

/** Alert level of the TCAS (mfd_tcas_alert_level) */
const TCAS_ALERT_LEVEL = { STBY: 0, TA: 1, TARA: 2 } as const;

export const CockpitControls = {
  strobe: (position: keyof typeof STROBE_POSITIONS): CrewAction[] => [
    { type: 'SET_LOCAL_VAR', name: 'L:LIGHTING_STROBE_0', value: STROBE_POSITIONS[position] },
  ],

  landingLights: (on: boolean): CrewAction[] => [
    { type: 'KEY_EVENT', name: on ? 'LANDING_LIGHTS_ON' : 'LANDING_LIGHTS_OFF', value: LANDING_LIGHTS },
  ],

  /** Nose light switch: T.O illuminates the takeoff and the taxi lights, TAXI only the taxi light */
  noseLight: (position: 'TO' | 'TAXI' | 'OFF'): CrewAction[] => {
    switch (position) {
      case 'TO':
        return [
          { type: 'KEY_EVENT', name: 'TAXI_LIGHTS_ON', value: NOSE_LIGHT },
          { type: 'KEY_EVENT', name: 'LANDING_LIGHTS_ON', value: NOSE_LIGHT },
        ];
      case 'TAXI':
        return [
          { type: 'KEY_EVENT', name: 'LANDING_LIGHTS_OFF', value: NOSE_LIGHT },
          { type: 'KEY_EVENT', name: 'TAXI_LIGHTS_ON', value: NOSE_LIGHT },
        ];
      default:
        return [
          { type: 'KEY_EVENT', name: 'LANDING_LIGHTS_OFF', value: NOSE_LIGHT },
          { type: 'KEY_EVENT', name: 'TAXI_LIGHTS_OFF', value: NOSE_LIGHT },
        ];
    }
  },

  runwayTurnoffLights: (on: boolean): CrewAction[] =>
    RUNWAY_TURNOFF_LIGHTS.map((index) => ({
      type: 'KEY_EVENT',
      name: on ? 'TAXI_LIGHTS_ON' : 'TAXI_LIGHTS_OFF',
      value: index,
    })),

  /** Transponder AUTO (with altitude reporting) or STBY, as on the MFD SURV page */
  transponderAuto: (auto: boolean): CrewAction[] => [
    { type: 'BUS_EVENT', topic: 'mfd_xpdr_set_auto', value: auto },
    ...(auto ? [{ type: 'BUS_EVENT', topic: 'mfd_xpdr_set_alt_reporting', value: true } as CrewAction] : []),
  ],

  tcas: (level: keyof typeof TCAS_ALERT_LEVEL): CrewAction[] => [
    { type: 'BUS_EVENT', topic: 'mfd_tcas_alert_level', value: TCAS_ALERT_LEVEL[level] },
  ],

  seatBelts: (on: boolean): CrewAction[] => [{ type: 'SEAT_BELTS', on }],

  groundSpoilersArm: (arm: boolean): CrewAction[] => [
    { type: 'KEY_EVENT', name: 'SPOILERS_ARM_SET', value: arm ? 1 : 0 },
  ],

  autobrakeRto: (): CrewAction[] => [{ type: 'PULSE_LOCAL_VAR', name: 'L:A32NX_OVHD_AUTOBRK_RTO_ARM_IS_PRESSED' }],

  autobrakeSelector: (position: AutobrakeSelector): CrewAction[] => [
    { type: 'SET_LOCAL_VAR', name: 'L:A32NX_AUTOBRAKES_SELECTED_MODE', value: position },
  ],

  takeoffConfigTest: (): CrewAction[] => [{ type: 'PULSE_LOCAL_VAR', name: 'L:A32NX_BTN_TOCONFIG' }],

  flaps: (index: number): CrewAction[] => [{ type: 'FLAPS_SET', index }],

  gearDown: (): CrewAction[] => [{ type: 'GEAR_DOWN' }],
};

/** Variables read by the crew to verify the cockpit controls */
export const CockpitStates = {
  strobe: 'L:LIGHTING_STROBE_0',
  landingLights: 'A:LIGHT LANDING:2',
  noseTakeoffLight: 'A:LIGHT LANDING:1',
  noseTaxiLight: 'A:LIGHT TAXI:1',
  runwayTurnoffLights: 'A:LIGHT TAXI:2',
  beacon: 'A:LIGHT BEACON',
  wingLights: 'A:LIGHT WING',
  seatBelts: 'A:CABIN SEATBELTS ALERT SWITCH',
  groundSpoilersArmed: 'L:A32NX_SPOILERS_ARMED',
  autobrakeArmedMode: 'L:A32NX_AUTOBRAKES_ARMED_MODE',
  autobrakeSelector: 'L:A32NX_AUTOBRAKES_SELECTED_MODE',
  tcasMode: 'L:A32NX_TCAS_MODE',
  parkingBrake: 'L:A32NX_PARK_BRAKE_LEVER_POS',
  /** In radians */
  rudderTrim: 'A:RUDDER TRIM',
  engineAntiIce: (engine: number) => `A:ENG ANTI ICE:${engine}`,
  wingAntiIce: 'A:STRUCTURAL DEICE SWITCH',
  engineState: (engine: number) => `L:A32NX_ENGINE_STATE:${engine}`,
  flapsLever: 'L:A32NX_FLAPS_HANDLE_INDEX',
  gearLever: 'L:A32NX_GEAR_HANDLE_POSITION',
  decisionHeight: 'L:AIRLINER_DECISION_HEIGHT',
  minimumDescentAltitude: 'L:AIRLINER_MINIMUM_DESCENT_ALTITUDE',
} as const;

/** Actions of the test section of the flyPad */
export const TestActions: Record<VirtualCrewTestActionId, CrewAction[]> = {
  strobeOn: CockpitControls.strobe('ON'),
  strobeAuto: CockpitControls.strobe('AUTO'),
  landingLightsOn: CockpitControls.landingLights(true),
  landingLightsOff: CockpitControls.landingLights(false),
  noseTakeoff: CockpitControls.noseLight('TO'),
  noseTaxi: CockpitControls.noseLight('TAXI'),
  noseOff: CockpitControls.noseLight('OFF'),
  runwayTurnoffOn: CockpitControls.runwayTurnoffLights(true),
  runwayTurnoffOff: CockpitControls.runwayTurnoffLights(false),
  xpdrAuto: CockpitControls.transponderAuto(true),
  xpdrStby: CockpitControls.transponderAuto(false),
  tcasTaRa: CockpitControls.tcas('TARA'),
  tcasStby: CockpitControls.tcas('STBY'),
  // the double cycle is a workflow, tested here with its first two toggles
  seatBeltsCycle: [...CockpitControls.seatBelts(false), ...CockpitControls.seatBelts(true)],
  spoilersArm: CockpitControls.groundSpoilersArm(true),
  spoilersDisarm: CockpitControls.groundSpoilersArm(false),
  autobrakeRto: CockpitControls.autobrakeRto(),
  autobrakeLow: CockpitControls.autobrakeSelector(AutobrakeSelector.Low),
  autobrakeDisarm: CockpitControls.autobrakeSelector(AutobrakeSelector.Disarm),
  toConfigTest: CockpitControls.takeoffConfigTest(),
};
