// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { CrewAction, CrewSeat, SimVarReader } from '../VirtualCrewTypes';

/** One item of a workflow, as listed in the SOP */
export interface WorkflowStep {
  /** SOP item, e.g. 'BATTERY 1 ... ON' */
  item: string;
  /** Time the crew member needs to reach and execute the item, in milliseconds */
  durationMs: number;
  /** The item is only executed when this returns true, e.g. 'If the AVAIL lights illuminate' */
  condition?: (read: SimVarReader) => boolean;
  /** Actions on the aircraft, none for items which are only verified */
  actions?: CrewAction[];
}

/**
 * A sequence of SOP items performed by one crew member, e.g. the initial power up of the first officer.
 * Workflows are only performed by the virtual crew member, the user performs the items of their own seat.
 */
export interface Workflow {
  /** Identifier, see VirtualCrewWorkflows in the shared VirtualCrew definitions */
  id: string;
  /** Seat responsible for the workflow in the SOP */
  seat: CrewSeat;
  steps: WorkflowStep[];
}
