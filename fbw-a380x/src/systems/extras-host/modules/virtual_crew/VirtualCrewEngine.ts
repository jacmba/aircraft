// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { AircraftSnapshot, CrewInput, CrewOutput } from './VirtualCrewTypes';
import { OrderStep, Procedure } from './procedures/Procedure';

export enum ProcedureState {
  /** The procedure is being executed */
  Running,
  /** Every step was executed */
  Completed,
  /** The pilot flying aborted the procedure */
  Aborted,
}

/**
 * Executes a procedure of the SOP. The pilot flying is the user, the engine plays the pilot monitoring:
 * - callouts of the pilot monitoring are made automatically when their condition is met
 * - orders of the pilot flying are given with the primary button, the pilot monitoring executes and confirms them
 * - the secondary button aborts the procedure when possible (e.g. "STOP" during the takeoff roll), otherwise it skips
 *   the pending order
 *
 * The engine only decides what the crew says and does, it neither reads nor writes the aircraft state itself.
 */
export class VirtualCrewEngine {
  private stepIndex = 0;

  private state = ProcedureState.Running;

  constructor(private readonly procedure: Procedure) {}

  /** Index of the next step to execute */
  public get currentStepIndex(): number {
    return this.stepIndex;
  }

  public get currentState(): ProcedureState {
    return this.state;
  }

  /** Identifier of the next step to execute, undefined if the procedure is not running */
  public get currentStepId(): string | undefined {
    return this.state === ProcedureState.Running ? this.procedure.steps[this.stepIndex]?.id : undefined;
  }

  /**
   * Evaluates the automatic part of the procedure
   * @param aircraft the current aircraft state
   * @returns the phrases and actions of the crew
   */
  public update(aircraft: AircraftSnapshot): CrewOutput {
    const output: CrewOutput = { speech: [], actions: [] };

    if (this.state !== ProcedureState.Running) {
      if (this.procedure.reset(aircraft)) {
        this.reset();
      }
      return output;
    }

    if (this.stepIndex === 0 && this.procedure.notApplicable?.(aircraft)) {
      this.state = ProcedureState.Completed;
      return output;
    }

    // several steps can be due in the same update, e.g. V1 and VR at the same speed
    while (this.state === ProcedureState.Running) {
      const step = this.procedure.steps[this.stepIndex];

      if (step.type === 'callout') {
        if (step.skip?.(aircraft)) {
          this.advance();
        } else if (step.when(aircraft)) {
          output.speech.push({ role: 'PM', line: step.line });
          this.advance();
        } else {
          break;
        }
      } else if (step.done(aircraft)) {
        // the order is not needed anymore, e.g. the pilot flying did it manually
        this.advance();
      } else {
        break;
      }
    }

    return output;
  }

  /**
   * Handles a button press of the pilot flying
   * @param input the pressed button
   * @param aircraft the current aircraft state
   * @returns the phrases and actions of the crew
   */
  public input(input: CrewInput, aircraft: AircraftSnapshot): CrewOutput {
    const output: CrewOutput = { speech: [], actions: [] };

    if (this.state !== ProcedureState.Running) {
      return output;
    }

    const step = this.procedure.steps[this.stepIndex];

    if (input === 'PRIMARY') {
      if (step.type === 'order' && step.available(aircraft)) {
        this.executeOrder(step, aircraft, output);
        this.advance();
      }
    } else if (this.procedure.abort?.available(aircraft, this.stepIndex)) {
      output.speech.push({ role: 'PF', line: this.procedure.abort.order });
      this.state = ProcedureState.Aborted;
    } else if (step.type === 'order') {
      this.advance();
    }

    return output;
  }

  /** Starts the procedure again from the beginning */
  public reset(): void {
    this.stepIndex = 0;
    this.state = ProcedureState.Running;
  }

  private executeOrder(step: OrderStep, aircraft: AircraftSnapshot, output: CrewOutput): void {
    output.speech.push({ role: 'PF', line: step.order });
    if (step.actions) {
      output.actions.push(...step.actions(aircraft));
    }
    if (step.confirmation) {
      output.speech.push({ role: 'PM', line: step.confirmation });
    }
  }

  private advance(): void {
    this.stepIndex++;
    if (this.stepIndex >= this.procedure.steps.length) {
      this.state = ProcedureState.Completed;
    }
  }
}
