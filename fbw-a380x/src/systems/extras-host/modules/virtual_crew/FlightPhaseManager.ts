// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import {
  VIRTUAL_CREW_PREFLIGHT_ACCELERATION,
  VIRTUAL_CREW_PREFLIGHT_DURATION_S,
  VirtualCrewCommand,
  VirtualCrewFlightPhase,
} from '../../../shared/src/VirtualCrew';
import { CrewAction, CrewSeat, SimVarReader } from './VirtualCrewTypes';
import { Workflow } from './workflows/Workflow';
import { WorkflowRunner } from './workflows/WorkflowRunner';
import { InitialPowerUpWorkflow } from './workflows/InitialPowerUpWorkflow';

/** Workflows performed when a phase starts, in this order */
export type PhaseWorkflows = Partial<Record<VirtualCrewFlightPhase, Workflow[]>>;

export const DefaultPhaseWorkflows: PhaseWorkflows = {
  [VirtualCrewFlightPhase.Preflight]: [InitialPowerUpWorkflow],
};

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

/**
 * Tracks the flight phase of the virtual crew, one phase per SOP chapter.
 *
 * - The preflight is optional: it is started from the flyPad and lasts 40 minutes. The countdown can be accelerated,
 *   but only while no crew member performs a workflow.
 * - The takeoff briefing follows the preflight, or is started directly from the flyPad.
 * - The takeoff is detected from the aircraft, whatever the current ground phase.
 */
export class FlightPhaseManager {
  private currentPhase = VirtualCrewFlightPhase.Idle;

  private preflightRemainingMs = 0;

  private accelerated = false;

  private lastUpdate: number | undefined;

  private readonly runner = new WorkflowRunner();

  constructor(private readonly phaseWorkflows: PhaseWorkflows = DefaultPhaseWorkflows) {}

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
        this.preflightRemainingMs = VIRTUAL_CREW_PREFLIGHT_DURATION_S * 1000;
        this.enterPhase(VirtualCrewFlightPhase.Preflight, context);
        return true;

      case VirtualCrewCommand.StartTakeoffBriefing:
        // the preflight can be skipped entirely, or left early when nobody is busy
        if (
          !context.onGround ||
          !(
            this.currentPhase === VirtualCrewFlightPhase.Idle ||
            (this.currentPhase === VirtualCrewFlightPhase.Preflight && !this.busy)
          )
        ) {
          return false;
        }
        this.preflightRemainingMs = 0;
        this.enterPhase(VirtualCrewFlightPhase.TakeoffBriefing, context);
        return true;

      case VirtualCrewCommand.ToggleAcceleration:
        if (this.currentPhase !== VirtualCrewFlightPhase.Preflight || this.busy) {
          return false;
        }
        this.accelerated = !this.accelerated;
        return true;

      case VirtualCrewCommand.CompleteTakeoffBriefing:
        if (this.currentPhase !== VirtualCrewFlightPhase.TakeoffBriefing) {
          return false;
        }
        this.enterPhase(VirtualCrewFlightPhase.BeforeStart, context);
        return true;

      case VirtualCrewCommand.Reset:
        this.runner.cancel();
        this.preflightRemainingMs = 0;
        this.enterPhase(VirtualCrewFlightPhase.Idle, context);
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

    const actions = this.runner.update(context.now, context.read);

    if (this.currentPhase === VirtualCrewFlightPhase.Preflight) {
      // the countdown is only accelerated while nobody performs a workflow
      if (this.busy) {
        this.accelerated = false;
      }
      const rate = this.accelerated ? VIRTUAL_CREW_PREFLIGHT_ACCELERATION : 1;
      this.preflightRemainingMs = Math.max(0, this.preflightRemainingMs - delta * rate);

      if (this.preflightRemainingMs === 0 && !this.busy) {
        this.enterPhase(VirtualCrewFlightPhase.TakeoffBriefing, context);
      }
    }

    if (GROUND_PHASES_BEFORE_TAKEOFF.includes(this.currentPhase) && context.takeoffRollStarted) {
      this.runner.cancel();
      this.preflightRemainingMs = 0;
      this.enterPhase(VirtualCrewFlightPhase.Takeoff, context);
    } else if (
      this.currentPhase === VirtualCrewFlightPhase.Takeoff &&
      context.takeoffProcedureCompleted &&
      !context.onGround
    ) {
      this.enterPhase(VirtualCrewFlightPhase.AfterTakeoff, context);
    } else if (this.currentPhase >= VirtualCrewFlightPhase.AfterTakeoff && context.onGround) {
      // the phases after takeoff are not covered yet, the flight ends with the landing
      this.enterPhase(VirtualCrewFlightPhase.Idle, context);
    }

    return actions;
  }

  private enterPhase(phase: VirtualCrewFlightPhase, context: FlightPhaseContext): void {
    this.currentPhase = phase;
    this.accelerated = false;

    for (const workflow of this.phaseWorkflows[phase] ?? []) {
      // the user performs the items of their own seat
      if (workflow.seat === context.virtualSeat) {
        this.runner.start(workflow, context.now);
      }
    }
  }
}
