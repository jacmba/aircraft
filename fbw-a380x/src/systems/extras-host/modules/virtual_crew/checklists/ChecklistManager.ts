// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { VirtualCrewChecklistId, VirtualCrewFlightPhase } from '../../../../shared/src/VirtualCrew';
import { SimVarReader } from '../VirtualCrewTypes';
import { Checklist, Checklists } from './Checklists';
import { ChecklistOutput, ChecklistRunner, EclState } from './ChecklistRunner';

/** State of the flight relevant for the checklists */
export interface ChecklistContext {
  phase: VirtualCrewFlightPhase;
  briefingDone: boolean;
}

/**
 * Decides which checklist can be requested and keeps track of the completed checklists of the flight:
 * - the cockpit preparation checklist ("down to the line") once the takeoff briefing has been performed
 * - the before start checklist ("below the line") once the cockpit preparation checklist is completed and the
 *   preflight is over
 */
export class ChecklistManager {
  public readonly runner = new ChecklistRunner();

  private readonly done = new Set<VirtualCrewChecklistId>();

  /** True if the checklist has been completed in the current flight */
  public isDone(id: VirtualCrewChecklistId): boolean {
    return this.done.has(id);
  }

  /**
   * The checklist which can be requested now
   * @param context the state of the flight
   * @returns the checklist or undefined if none can be requested
   */
  public available(context: ChecklistContext): Checklist | undefined {
    if (this.runner.running) {
      return undefined;
    }
    return Checklists.find((checklist) => !this.done.has(checklist.id) && this.isAvailable(checklist, context));
  }

  /**
   * The pilot flying requests the available checklist
   * @param context the state of the flight
   * @param now the current time in milliseconds
   * @returns the output of the crew, undefined if no checklist can be requested
   */
  public request(context: ChecklistContext, now: number): ChecklistOutput | undefined {
    const checklist = this.available(context);
    return checklist ? this.runner.start(checklist, now) : undefined;
  }

  public update(now: number, ecl: EclState, read: SimVarReader): ChecklistOutput {
    const output = this.runner.update(now, ecl, read);
    const completed = this.runner.takeCompleted();
    if (completed) {
      this.done.add(completed.id);
    }
    return output;
  }

  /** Forgets the checklists of the flight */
  public reset(): void {
    this.runner.cancel();
    this.done.clear();
  }

  private isAvailable(checklist: Checklist, context: ChecklistContext): boolean {
    switch (checklist.id) {
      case 'cockpitPreparation':
        return (
          context.briefingDone &&
          (context.phase === VirtualCrewFlightPhase.Preflight || context.phase === VirtualCrewFlightPhase.BeforeStart)
        );
      case 'beforeStart':
        return this.done.has('cockpitPreparation') && context.phase === VirtualCrewFlightPhase.BeforeStart;
      default:
        return false;
    }
  }
}
