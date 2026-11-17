// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import {
  VIRTUAL_CREW_PREFLIGHT_ACCELERATION,
  VIRTUAL_CREW_PREFLIGHT_DURATION_S,
  VirtualCrewCommand,
  VirtualCrewFlightPhase,
  VirtualCrewWorkflows,
} from '../../../shared/src/VirtualCrew';
import { CrewAction, CrewSeat, SimVarReader } from './VirtualCrewTypes';
import { Workflow } from './workflows/Workflow';
import { WorkflowRunner } from './workflows/WorkflowRunner';
import { InitialPowerUpWorkflow } from './workflows/InitialPowerUpWorkflow';
import {
  AircraftStatusWorkflow,
  FireTestApuStartWorkflow,
  FmsCrosscheckWorkflow,
  GlareshieldWorkflow,
  OverheadPanelWorkflow,
  PedestalWorkflow,
} from './workflows/PreflightWorkflows';

/** A workflow performed at a given time after the start of the preflight */
export interface PreflightEvent {
  /** Time after the start of the preflight, in seconds of the (possibly accelerated) preflight countdown */
  atS: number;
  workflow: Workflow;
}

const workflowsById = new Map<string, Workflow>(
  [
    InitialPowerUpWorkflow,
    AircraftStatusWorkflow,
    FireTestApuStartWorkflow,
    OverheadPanelWorkflow,
    PedestalWorkflow,
    GlareshieldWorkflow,
    FmsCrosscheckWorkflow,
  ].map((workflow) => [workflow.id, workflow]),
);

/** The preflight schedule, as defined in the shared VirtualCrewWorkflows (also shown in the flyPad) */
export const DefaultPreflightSchedule: PreflightEvent[] = VirtualCrewWorkflows.map((definition) => {
  const workflow = workflowsById.get(definition.id);
  if (workflow === undefined) {
    throw new Error(`[VirtualCrew] workflow ${definition.id} is not implemented`);
  }
  return { atS: definition.preflightMinute * 60, workflow };
});

/** Information needed by the phase manager at each update */
export interface FlightPhaseContext {
  /** Current simulation time, in milliseconds. It does not advance while the simulation is paused. */
  now: number;
  read: SimVarReader;
  /** Seat of the virtual crew member, the user occupies the other one */
  virtualSeat: CrewSeat;
  onGround: boolean;
  /** The takeoff roll has started (thrust levers in takeoff position and accelerating) */
  takeoffRollStarted: boolean;
  /** The takeoff procedure (up to flaps zero) is completed */
  takeoffProcedureCompleted: boolean;
}

export interface FlightPhaseStatus {
  phase: VirtualCrewFlightPhase;
  /** Remaining time of the preflight, in seconds */
  preflightRemainingS: number;
  /** True if the preflight countdown is accelerated */
  accelerated: boolean;
  /** Workflow performed by the virtual crew member, undefined if none */
  workflowId: string | undefined;
  /** True if the takeoff briefing has been performed in the current flight */
  briefingDone: boolean;
}

/** Maximum time step taken into account, so that a jump of the simulation time does not end the preflight */
const MAX_TIME_STEP_MS = 1000;

const GROUND_PHASES_BEFORE_TAKEOFF = [
  VirtualCrewFlightPhase.Idle,
  VirtualCrewFlightPhase.Preflight,
  VirtualCrewFlightPhase.TakeoffBriefing,
  VirtualCrewFlightPhase.BeforeStart,
  VirtualCrewFlightPhase.EngineStart,
  VirtualCrewFlightPhase.AfterStart,
  VirtualCrewFlightPhase.Taxi,
  VirtualCrewFlightPhase.BeforeTakeoff,
];

/** Phases in which the takeoff briefing can be performed */
const BRIEFING_PHASES = [
  VirtualCrewFlightPhase.Preflight,
  VirtualCrewFlightPhase.TakeoffBriefing,
  VirtualCrewFlightPhase.BeforeStart,
];

/**
 * Tracks the flight phase of the virtual crew, one phase per SOP chapter.
 *
 * - The preflight is optional and lasts 40 minutes. During the countdown, the virtual crew member performs the
 *   workflows of their seat at the scheduled times, and the pilot flying performs the takeoff briefing. The preflight
 *   only ends when the countdown reaches zero, which can be accelerated while no crew member performs a workflow.
 * - Without preflight, the flight starts with the takeoff briefing.
 * - The takeoff is detected from the aircraft, whatever the current ground phase.
 */
export class FlightPhaseManager {
  private currentPhase = VirtualCrewFlightPhase.Idle;

  private preflightRemainingMs = 0;

  private accelerated = false;

  private briefingDone = false;

  /** Number of preflight events which have been started */
  private startedEvents = 0;

  private lastUpdate: number | undefined;

  private readonly runner = new WorkflowRunner();

  /**
   * @param schedule the workflows of the preflight, sorted by time
   */
  constructor(private readonly schedule: PreflightEvent[] = DefaultPreflightSchedule) {}

  public get phase(): VirtualCrewFlightPhase {
    return this.currentPhase;
  }

  /** True while a crew member performs a workflow */
  public get busy(): boolean {
    return this.runner.busy;
  }

  public get status(): FlightPhaseStatus {
    return {
      phase: this.currentPhase,
      preflightRemainingS: Math.ceil(this.preflightRemainingMs / 1000),
      accelerated: this.accelerated,
      workflowId: this.runner.currentWorkflowId,
      briefingDone: this.briefingDone,
    };
  }

  /**
   * Handles a command of the flyPad
   * @param command the command
   * @param context the current context
   * @returns true if the command was accepted
   */
  public command(command: VirtualCrewCommand, context: FlightPhaseContext): boolean {
    switch (command) {
      case VirtualCrewCommand.StartPreflight:
        if (this.currentPhase !== VirtualCrewFlightPhase.Idle || !context.onGround) {
          return false;
        }
        this.startFlight();
        this.preflightRemainingMs = VIRTUAL_CREW_PREFLIGHT_DURATION_S * 1000;
        this.currentPhase = VirtualCrewFlightPhase.Preflight;
        // the events at the start of the preflight begin right away
        this.startDueEvents(context);
        return true;

      case VirtualCrewCommand.StartTakeoffBriefing:
        // the preflight is skipped entirely
        if (this.currentPhase !== VirtualCrewFlightPhase.Idle || !context.onGround) {
          return false;
        }
        this.startFlight();
        this.currentPhase = VirtualCrewFlightPhase.TakeoffBriefing;
        return true;

      case VirtualCrewCommand.ToggleAcceleration:
        if (this.currentPhase !== VirtualCrewFlightPhase.Preflight || this.busy) {
          return false;
        }
        this.accelerated = !this.accelerated;
        return true;

      case VirtualCrewCommand.CompleteTakeoffBriefing:
        if (!BRIEFING_PHASES.includes(this.currentPhase) || this.briefingDone) {
          return false;
        }
        this.briefingDone = true;
        // during the preflight the briefing is one of the tasks, it does not end the phase
        if (this.currentPhase === VirtualCrewFlightPhase.TakeoffBriefing) {
          this.currentPhase = VirtualCrewFlightPhase.BeforeStart;
        }
        return true;

      case VirtualCrewCommand.Reset:
        this.runner.cancel();
        this.startFlight();
        this.currentPhase = VirtualCrewFlightPhase.Idle;
        return true;

      default:
        return false;
    }
  }

  /**
   * Advances the phase and the workflows
   * @param context the current context
   * @returns the actions of the virtual crew member on the aircraft
   */
  public update(context: FlightPhaseContext): CrewAction[] {
    const delta =
      this.lastUpdate === undefined ? 0 : Math.min(MAX_TIME_STEP_MS, Math.max(0, context.now - this.lastUpdate));
    this.lastUpdate = context.now;

    if (this.currentPhase === VirtualCrewFlightPhase.Preflight) {
      // the countdown is only accelerated while nobody performs a workflow
      if (this.busy) {
        this.accelerated = false;
      }
      const rate = this.accelerated ? VIRTUAL_CREW_PREFLIGHT_ACCELERATION : 1;
      this.preflightRemainingMs = Math.max(0, this.preflightRemainingMs - delta * rate);
      this.startDueEvents(context);
    }

    const actions = this.runner.update(context.now, context.read);

    if (
      this.currentPhase === VirtualCrewFlightPhase.Preflight &&
      this.preflightRemainingMs === 0 &&
      this.startedEvents === this.schedule.length &&
      !this.busy
    ) {
      // the takeoff briefing belongs to the preflight, the crew continues with the next SOP chapter
      this.currentPhase = VirtualCrewFlightPhase.BeforeStart;
      this.accelerated = false;
    }

    if (GROUND_PHASES_BEFORE_TAKEOFF.includes(this.currentPhase) && context.takeoffRollStarted) {
      this.runner.cancel();
      this.preflightRemainingMs = 0;
      this.accelerated = false;
      this.currentPhase = VirtualCrewFlightPhase.Takeoff;
    } else if (
      this.currentPhase === VirtualCrewFlightPhase.Takeoff &&
      context.takeoffProcedureCompleted &&
      !context.onGround
    ) {
      this.currentPhase = VirtualCrewFlightPhase.AfterTakeoff;
    } else if (this.currentPhase >= VirtualCrewFlightPhase.AfterTakeoff && context.onGround) {
      // the phases after takeoff are not covered yet, the flight ends with the landing
      this.startFlight();
      this.currentPhase = VirtualCrewFlightPhase.Idle;
    }

    return actions;
  }

  /** Clears the state of the previous flight */
  private startFlight(): void {
    this.preflightRemainingMs = 0;
    this.accelerated = false;
    this.briefingDone = false;
    this.startedEvents = 0;
  }

  /** Starts the workflows whose time has come, the workflows of the seat of the user are left to the user */
  private startDueEvents(context: FlightPhaseContext): void {
    const elapsedS = VIRTUAL_CREW_PREFLIGHT_DURATION_S - this.preflightRemainingMs / 1000;

    while (this.startedEvents < this.schedule.length && this.schedule[this.startedEvents].atS <= elapsedS) {
      const { workflow } = this.schedule[this.startedEvents];
      if (workflow.seat === context.virtualSeat) {
        this.runner.start(workflow, context.now);
        // a running workflow stops the acceleration
        this.accelerated = false;
      }
      this.startedEvents++;
    }
  }
}
