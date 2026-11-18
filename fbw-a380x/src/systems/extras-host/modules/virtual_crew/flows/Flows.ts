// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { VirtualCrewFlightPhase, VirtualCrewFlowId } from '../../../../shared/src/VirtualCrew';
import { AircraftSnapshot, CrewOutput, SimVarReader } from '../VirtualCrewTypes';
import { verify, Workflow, WorkflowStep } from '../workflows/Workflow';
import { WorkflowRunner } from '../workflows/WorkflowRunner';
import { AUTOBRAKE_ARMED_MODE_RTO, CockpitControls, CockpitStates } from '../CockpitControls';
import { BriefingVars } from '../briefing/BriefingData';

/*
 * Flows of the pilot monitoring (the virtual crew member) after the preflight, FBW A380X SOP. The flows are performed
 * once per flight when their trigger occurs, or on request of the pilot flying (line-up flow). The items of the
 * captain are left to the user: APU, FMS, seat belts signs, anti ice, nose and runway turnoff lights for the taxi.
 */

const isOn = (read: SimVarReader, name: string) => read(name) === 1;

/** The seat belts signs are switched to the other position, twice off and on again: the signal to the cabin */
const seatBeltsToggle = (item: string): WorkflowStep => ({
  item,
  durationMs: 1200,
  actions: (read) => CockpitControls.seatBelts(!isOn(read, CockpitStates.seatBelts)),
});

/** SOP "Before Pushback or Start", below the line, once the beacon is on */
export const BeforeStartFlow: Workflow = {
  id: 'beforeStartFlow',
  seat: 'FO',
  steps: [
    verify('WINDOWS AND DOORS ... CHECK CLOSED', 2000),
    { item: 'TRANSPONDER ... AUTO', durationMs: 2000, actions: CockpitControls.transponderAuto(true) },
  ],
};

/** SOP "After Start", when the engine mode selector is back to NORM */
export const AfterStartFlow: Workflow = {
  id: 'afterStartFlow',
  seat: 'FO',
  steps: [
    {
      item: 'GROUND SPOILERS ... ARM',
      durationMs: 2500,
      condition: (read) => !isOn(read, CockpitStates.groundSpoilersArmed),
      actions: CockpitControls.groundSpoilersArm(true),
    },
    {
      item: 'FLAPS ... SET FOR TAKEOFF (as briefed)',
      durationMs: 2500,
      condition: (read) => read(BriefingVars.TakeoffFlaps) > 0,
      actions: (read) => CockpitControls.flaps(read(BriefingVars.TakeoffFlaps)),
    },
    {
      item: 'AUTOBRAKE ... RTO',
      durationMs: 2000,
      condition: (read) => read(CockpitStates.autobrakeArmedMode) !== AUTOBRAKE_ARMED_MODE_RTO,
      actions: CockpitControls.autobrakeRto(),
    },
    verify('PITCH TRIM ... CHECK', 2000),
    verify('RUDDER TRIM ... CHECK ZERO', 1500),
  ],
};

/** SOP "Before Takeoff", at the holding point on request of the pilot flying */
export const LineUpFlow: Workflow = {
  id: 'lineUpFlow',
  seat: 'FO',
  steps: [
    { item: 'STROBE ... ON', durationMs: 1500, actions: CockpitControls.strobe('ON') },
    { item: 'TCAS ... TA/RA', durationMs: 2000, actions: CockpitControls.tcas('TARA') },
    seatBeltsToggle('SEAT BELTS ... CYCLE (1)'),
    seatBeltsToggle('SEAT BELTS ... CYCLE (2)'),
    seatBeltsToggle('SEAT BELTS ... CYCLE (3)'),
    seatBeltsToggle('SEAT BELTS ... CYCLE (4)'),
    {
      item: 'CABIN CREW ... ADVISE',
      durationMs: 1500,
      speech: [{ role: 'PM', line: 'paSeatsForTakeoff' }],
    },
  ],
};

/** SOP "After Takeoff", once the flaps are retracted */
export const AfterTakeoffFlow: Workflow = {
  id: 'afterTakeoffFlow',
  seat: 'FO',
  steps: [
    {
      item: 'GROUND SPOILERS ... DISARM',
      durationMs: 2000,
      condition: (read) => isOn(read, CockpitStates.groundSpoilersArmed),
      actions: CockpitControls.groundSpoilersArm(false),
    },
    { item: 'NOSE LIGHT ... OFF', durationMs: 1500, actions: CockpitControls.noseLight('OFF') },
    { item: 'RWY TURN OFF LIGHTS ... OFF', durationMs: 1000, actions: CockpitControls.runwayTurnoffLights(false) },
  ],
};

/** SOP "Climb", passing 10000 ft */
export const ClimbTenThousandFlow: Workflow = {
  id: 'climbTenThousandFlow',
  seat: 'FO',
  steps: [{ item: 'LANDING LIGHTS ... OFF', durationMs: 2000, actions: CockpitControls.landingLights(false) }],
};

/** SOP "Descent Preparation", the autobrake as briefed */
export const ApproachBriefingFlow: Workflow = {
  id: 'approachBriefingFlow',
  seat: 'FO',
  steps: [
    {
      item: 'AUTOBRAKE ... SET (as briefed)',
      durationMs: 3000,
      condition: (read) => read(BriefingVars.Autobrake) >= 0,
      actions: (read) => CockpitControls.autobrakeSelector(read(BriefingVars.Autobrake)),
    },
  ],
};

/** SOP "Descent", passing 10000 ft */
export const DescentTenThousandFlow: Workflow = {
  id: 'descentTenThousandFlow',
  seat: 'FO',
  steps: [
    { item: 'LANDING LIGHTS ... ON', durationMs: 2000, actions: CockpitControls.landingLights(true) },
    {
      item: 'CABIN CREW ... ADVISE',
      durationMs: 1500,
      speech: [{ role: 'PM', line: 'paSeatsForLanding' }],
    },
  ],
};

/** SOP "After Landing", once the runway is vacated */
export const AfterLandingFlow: Workflow = {
  id: 'afterLandingFlow',
  seat: 'FO',
  steps: [
    { item: 'FLAPS ... RETRACT', durationMs: 2000, actions: CockpitControls.flaps(0) },
    { item: 'STROBE ... AUTO', durationMs: 1500, actions: CockpitControls.strobe('AUTO') },
    { item: 'LANDING LIGHTS ... OFF', durationMs: 1500, actions: CockpitControls.landingLights(false) },
    { item: 'NOSE LIGHT ... TAXI', durationMs: 1000, actions: CockpitControls.noseLight('TAXI') },
    { item: 'TCAS ... STBY', durationMs: 2000, actions: CockpitControls.tcas('STBY') },
    verify('RADAR ... OFF (not automated yet)', 1500),
  ],
};

/** State of the flight relevant for the flow triggers */
export interface FlowContext {
  now: number;
  phase: VirtualCrewFlightPhase;
  aircraft: AircraftSnapshot;
  read: SimVarReader;
  isChecklistDone: (id: string) => boolean;
  approachBriefingDone: boolean;
  /** True if the flow has already been started in this flight */
  isFlowStarted?: (id: VirtualCrewFlowId) => boolean;
}

interface FlowDefinition {
  workflow: Workflow;
  /** The flow is started once per flight when this returns true, never if not defined (requested by the crew) */
  trigger?: (context: FlowContext) => boolean;
}

const TEN_THOUSAND_FEET = 10000;

const inPhase = (context: FlowContext, ...phases: VirtualCrewFlightPhase[]) => phases.includes(context.phase);

/** The flows with their triggers, see VirtualCrewFlows in the shared definitions */
export const FlowDefinitions: Record<VirtualCrewFlowId, FlowDefinition> = {
  beforeStartFlow: {
    workflow: BeforeStartFlow,
    trigger: (c) =>
      inPhase(c, VirtualCrewFlightPhase.BeforeStart, VirtualCrewFlightPhase.EngineStart) &&
      c.isChecklistDone('beforeStart') &&
      isOn(c.read, CockpitStates.beacon),
  },
  afterStartFlow: { workflow: AfterStartFlow, trigger: (c) => inPhase(c, VirtualCrewFlightPhase.AfterStart) },
  lineUpFlow: { workflow: LineUpFlow },
  afterTakeoffFlow: { workflow: AfterTakeoffFlow, trigger: (c) => inPhase(c, VirtualCrewFlightPhase.AfterTakeoff) },
  climbTenThousandFlow: {
    workflow: ClimbTenThousandFlow,
    trigger: (c) =>
      inPhase(c, VirtualCrewFlightPhase.AfterTakeoff, VirtualCrewFlightPhase.Climb, VirtualCrewFlightPhase.Cruise) &&
      !c.aircraft.onGround &&
      (c.aircraft.altitude ?? 0) > TEN_THOUSAND_FEET &&
      c.aircraft.verticalSpeed > 0,
  },
  approachBriefingFlow: { workflow: ApproachBriefingFlow, trigger: (c) => c.approachBriefingDone },
  descentTenThousandFlow: {
    workflow: DescentTenThousandFlow,
    trigger: (c) =>
      inPhase(
        c,
        VirtualCrewFlightPhase.Cruise,
        VirtualCrewFlightPhase.DescentPreparation,
        VirtualCrewFlightPhase.Descent,
        VirtualCrewFlightPhase.Approach,
      ) &&
      !c.aircraft.onGround &&
      // only after the climb above 10000 ft, the landing lights are still on otherwise
      (c.isFlowStarted?.('climbTenThousandFlow') ?? false) &&
      (c.aircraft.altitude ?? Infinity) < TEN_THOUSAND_FEET &&
      c.aircraft.verticalSpeed < 0,
  },
  afterLandingFlow: { workflow: AfterLandingFlow, trigger: (c) => inPhase(c, VirtualCrewFlightPhase.AfterLanding) },
};

/**
 * Starts the flows of the pilot monitoring when their trigger occurs, each once per flight, and performs them at a
 * human pace one after the other.
 */
export class FlowManager {
  private readonly runner = new WorkflowRunner();

  private readonly started = new Set<VirtualCrewFlowId>();

  /** True while a flow is being performed */
  public get busy(): boolean {
    return this.runner.busy;
  }

  public get currentFlowId(): string | undefined {
    return this.runner.currentWorkflowId;
  }

  /** True if the flow has been started in this flight */
  public isStarted(id: VirtualCrewFlowId): boolean {
    return this.started.has(id);
  }

  /** True if the flow has been performed entirely in this flight */
  public isDone(id: VirtualCrewFlowId): boolean {
    return this.started.has(id) && !this.runner.isPendingOrRunning(id);
  }

  /**
   * Starts a flow on request of the pilot flying
   * @param id the flow
   * @param now the current time in milliseconds
   */
  public start(id: VirtualCrewFlowId, now: number): void {
    if (!this.started.has(id)) {
      this.started.add(id);
      this.runner.start(FlowDefinitions[id].workflow, now);
    }
  }

  public update(context: FlowContext): CrewOutput {
    const withFlows: FlowContext = { ...context, isFlowStarted: (id) => this.started.has(id) };
    for (const [id, definition] of Object.entries(FlowDefinitions) as [VirtualCrewFlowId, FlowDefinition][]) {
      if (!this.started.has(id) && definition.trigger?.(withFlows)) {
        this.start(id, context.now);
      }
    }
    return this.runner.update(context.now, context.read);
  }

  /** Forgets the flows of the flight */
  public reset(): void {
    this.runner.cancel();
    this.started.clear();
  }
}
