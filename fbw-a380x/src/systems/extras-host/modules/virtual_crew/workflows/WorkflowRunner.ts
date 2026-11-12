// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { CrewAction, SimVarReader } from '../VirtualCrewTypes';
import { Workflow } from './Workflow';

/**
 * Performs workflows of the virtual crew one after the other, item by item, at a human pace.
 */
export class WorkflowRunner {
  private readonly queue: Workflow[] = [];

  private current: Workflow | undefined;

  private stepIndex = 0;

  /** Time at which the current item is executed, in milliseconds */
  private nextStepAt = 0;

  /** True while a workflow is being performed, the queued workflows follow without interruption */
  public get busy(): boolean {
    return this.current !== undefined;
  }

  /** Identifier of the workflow being performed, undefined if none */
  public get currentWorkflowId(): string | undefined {
    return this.current?.id;
  }

  /**
   * Starts a workflow, or queues it if another one is being performed
   * @param workflow the workflow
   * @param now the current time in milliseconds
   */
  public start(workflow: Workflow, now: number): void {
    if (this.current === undefined) {
      this.begin(workflow, now);
    } else {
      this.queue.push(workflow);
    }
  }

  /** Stops the current workflow and drops the pending ones */
  public cancel(): void {
    this.queue.length = 0;
    this.current = undefined;
  }

  /**
   * Executes the items which are due
   * @param now the current time in milliseconds
   * @param read reads simulator variables for the conditions of the items
   * @returns the actions on the aircraft
   */
  public update(now: number, read: SimVarReader): CrewAction[] {
    const actions: CrewAction[] = [];

    while (this.current !== undefined && now >= this.nextStepAt) {
      const step = this.current.steps[this.stepIndex];
      if (step && (step.condition?.(read) ?? true)) {
        actions.push(...(step.actions ?? []));
      }

      this.stepIndex++;
      const next = this.current.steps[this.stepIndex];
      if (next === undefined) {
        // the next workflow starts when this one is finished
        const following = this.queue.shift();
        if (following === undefined) {
          this.current = undefined;
        } else {
          this.begin(following, this.nextStepAt);
        }
      } else {
        this.nextStepAt += next.durationMs;
      }
    }

    return actions;
  }

  private begin(workflow: Workflow, startTime: number): void {
    this.current = workflow;
    this.stepIndex = 0;
    this.nextStepAt = startTime + (workflow.steps[0]?.durationMs ?? 0);
  }
}
