// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { VirtualCrewChecklistId } from '../../../../shared/src/VirtualCrew';
import { SimVarReader, VoiceLineId } from '../VirtualCrewTypes';

/** An item of a normal checklist of the ECL */
export interface ChecklistItem {
  /** Item as displayed on the ECL */
  name: string;
  /** Challenge read by the pilot monitoring */
  challenge: VoiceLineId;
  /** Response of the pilot flying */
  response: VoiceLineId;
  /**
   * True if the item is sensed by the FWS: the ECL checks it automatically when the condition is met, the pilot
   * monitoring only confirms it on the ECL.
   */
  sensed: boolean;
  /** Verification of a non sensed item by the pilot monitoring, the item is accepted if not defined */
  verify?: (read: SimVarReader) => boolean;
}

export interface Checklist {
  id: VirtualCrewChecklistId;
  /** ID of the normal checklist in the ECL (EcamNormalProcedures) */
  eclId: number;
  /** Announcement of the pilot flying when requesting the checklist */
  request: VoiceLineId;
  /** Announcement of the pilot monitoring when the checklist is completed */
  complete: VoiceLineId;
  /** The items, in the order of the ECL */
  items: ChecklistItem[];
}

/** ECL "COCKPIT PREPARATION", the part of the before start checklist down to the line */
export const CockpitPreparationChecklist: Checklist = {
  id: 'cockpitPreparation',
  eclId: 1000001,
  request: 'cockpitPreparationChecklist',
  complete: 'cockpitPreparationChecklistComplete',
  items: [
    { name: 'GEAR PINS & COVERS', challenge: 'clGearPinsAndCovers', response: 'respRemoved', sensed: false },
    { name: 'FUEL QUANTITY', challenge: 'clFuelQuantity', response: 'respChecked', sensed: false },
    { name: 'SEAT BELTS', challenge: 'clSeatBelts', response: 'respOn', sensed: true },
    { name: 'BARO REF', challenge: 'clBaroRef', response: 'respSetBoth', sensed: false },
  ],
};

/** ECL "BEFORE START", the part of the before start checklist below the line */
export const BeforeStartChecklist: Checklist = {
  id: 'beforeStart',
  eclId: 1000002,
  request: 'beforeStartChecklist',
  complete: 'beforeStartChecklistComplete',
  items: [
    {
      name: 'PARKING BRAKE',
      challenge: 'clParkingBrake',
      response: 'respSet',
      sensed: false,
      verify: (read) => read('L:A32NX_PARK_BRAKE_LEVER_POS') === 1,
    },
    {
      name: 'T.O SPEEDS & THRUST',
      challenge: 'clTakeoffSpeedsAndThrust',
      response: 'respSetBoth',
      sensed: false,
      verify: (read) =>
        read('L:AIRLINER_V1_SPEED') > 0 && read('L:AIRLINER_VR_SPEED') > 0 && read('L:AIRLINER_V2_SPEED') > 0,
    },
    { name: 'BEACON', challenge: 'clBeacon', response: 'respOn', sensed: true },
  ],
};

/** The checklists, in the order of VirtualCrewChecklists */
export const Checklists: Checklist[] = [CockpitPreparationChecklist, BeforeStartChecklist];
