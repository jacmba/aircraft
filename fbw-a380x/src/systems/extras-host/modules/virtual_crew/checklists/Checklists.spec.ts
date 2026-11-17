// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { beforeEach, describe, expect, it } from 'vitest';
import {
  VirtualCrewChecklists,
  VirtualCrewChecklistStep,
  VirtualCrewFlightPhase,
} from '../../../../shared/src/VirtualCrew';
import { BeforeStartChecklist, Checklist, CockpitPreparationChecklist, Checklists } from './Checklists';
import { ChecklistOutput, ChecklistRunner, ECL_CL_COMPLETE_LINE, EclState, EcpButton } from './ChecklistRunner';
import { ChecklistManager } from './ChecklistManager';

const CL_RESET_LINE = -6;

/** Minimal model of the normal checklists of the FWS (FwsNormalChecklists / ProcedureLinesGenerator) */
class FakeEcl {
  public shown = false;

  public checklistId = 0;

  public selectedLine = 0;

  public readonly states = new Map<number, { itemsChecked: boolean[]; procedureCompleted: boolean }>();

  /** Values of the sensed items by ECL ID */
  public readonly sensed = new Map<number, (boolean | null)[]>();

  public frozen = false;

  constructor(checklists: Checklist[]) {
    for (const checklist of checklists) {
      this.states.set(checklist.eclId, {
        itemsChecked: checklist.items.map(() => false),
        procedureCompleted: false,
      });
      this.sensed.set(
        checklist.eclId,
        checklist.items.map((item) => (item.sensed ? false : null)),
      );
    }
  }

  public get state(): EclState {
    this.updateSensed();
    return {
      shown: this.shown,
      checklistId: this.checklistId,
      selectedLine: this.selectedLine,
      checklists: this.states,
    };
  }

  public setSensed(eclId: number, index: number, value: boolean): void {
    this.sensed.get(eclId)![index] = value;
    this.updateSensed();
  }

  public press(button: EcpButton): void {
    if (this.frozen) {
      return;
    }
    const ids = [...this.states.keys()].sort((a, b) => a - b);
    switch (button) {
      case 'CL':
        this.shown = !this.shown;
        this.checklistId = 0;
        this.selectFirst();
        break;
      case 'DOWN':
        if (this.checklistId === 0) {
          this.selectedLine = Math.min(this.selectedLine + 1, ids.length - 1);
        } else {
          this.moveDown();
        }
        break;
      case 'UP':
        if (this.checklistId === 0) {
          this.selectedLine = Math.max(this.selectedLine - 1, 0);
        } else if (this.selectedLine === CL_RESET_LINE) {
          this.selectedLine = ECL_CL_COMPLETE_LINE;
        } else {
          const selectable = this.selectable();
          const previous = selectable.filter((i) => i < this.selectedLine || this.selectedLine < 0);
          this.selectedLine = previous[previous.length - 1] ?? 0;
        }
        break;
      case 'CHECK': {
        if (this.checklistId === 0) {
          this.checklistId = ids[this.selectedLine];
          this.selectFirst();
          break;
        }
        const state = this.states.get(this.checklistId)!;
        const sensed = this.sensed.get(this.checklistId)!;
        if (this.selectedLine >= 0 && sensed[this.selectedLine] === null) {
          state.itemsChecked[this.selectedLine] = !state.itemsChecked[this.selectedLine];
          this.moveDown();
        } else if (this.selectedLine === ECL_CL_COMPLETE_LINE) {
          state.procedureCompleted = true;
          state.itemsChecked = state.itemsChecked.map((value, i) => (sensed[i] === null ? true : value));
        }
        break;
      }
    }
  }

  private updateSensed(): void {
    this.sensed.forEach((values, eclId) => {
      const state = this.states.get(eclId)!;
      values.forEach((value, i) => {
        if (value !== null) {
          state.itemsChecked[i] = value;
        }
      });
    });
  }

  private selectable(): number[] {
    const state = this.states.get(this.checklistId)!;
    const sensed = this.sensed.get(this.checklistId)!;
    return state.itemsChecked.map((_, i) => i).filter((i) => !(sensed[i] !== null && state.itemsChecked[i]));
  }

  private selectFirst(): void {
    if (this.checklistId === 0) {
      const ids = [...this.states.keys()].sort((a, b) => a - b);
      const first = ids.findIndex((id) => !this.states.get(id)!.procedureCompleted);
      this.selectedLine = first === -1 ? 0 : first;
      return;
    }
    const state = this.states.get(this.checklistId)!;
    if (state.procedureCompleted) {
      this.selectedLine = CL_RESET_LINE;
      return;
    }
    const unchecked = this.selectable().filter((i) => !state.itemsChecked[i]);
    this.selectedLine = unchecked[0] ?? ECL_CL_COMPLETE_LINE;
  }

  private moveDown(): void {
    const selectable = this.selectable();
    if (this.selectedLine === ECL_CL_COMPLETE_LINE) {
      this.selectedLine = CL_RESET_LINE;
    } else if (this.selectedLine >= 0) {
      this.selectedLine = selectable.find((i) => i > this.selectedLine) ?? ECL_CL_COMPLETE_LINE;
    }
  }
}

describe('virtual crew checklists', () => {
  let ecl: FakeEcl;
  let runner: ChecklistRunner;
  let now: number;
  let speech: string[];
  let presses: EcpButton[];
  let vars: Record<string, number>;

  const read = (name: string) => vars[name] ?? 0;

  const collect = (output: ChecklistOutput) => {
    speech.push(...output.speech.map((s) => `${s.role}:${s.line}`));
    presses.push(...output.presses);
    output.presses.forEach((button) => ecl.press(button));
  };

  /**
   * Lets the time pass in steps of 100 ms
   * @param seconds the time to pass
   */
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 10; i++) {
      now += 100;
      collect(runner.update(now, ecl.state, read));
    }
  };

  beforeEach(() => {
    ecl = new FakeEcl(Checklists);
    runner = new ChecklistRunner();
    now = 0;
    speech = [];
    presses = [];
    vars = {};
  });

  it('matches the shared definitions shown in the flyPad', () => {
    expect(
      Checklists.map((checklist) => ({
        id: checklist.id,
        eclId: checklist.eclId,
        items: checklist.items.map((item) => item.name),
      })),
    ).toEqual(VirtualCrewChecklists.map(({ id, eclId, items }) => ({ id, eclId, items })));
  });

  it('reads the cockpit preparation checklist with the pilot flying and completes it on the ECL', () => {
    ecl.setSensed(CockpitPreparationChecklist.eclId, 2, true); // seat belts on
    collect(runner.start(CockpitPreparationChecklist, now));

    run(5);
    // the pilot monitoring opened the checklist from the ECL menu
    expect(presses).toEqual(['CL', 'CHECK']);
    expect(ecl.checklistId).toBe(CockpitPreparationChecklist.eclId);
    expect(runner.currentStep).toBe(VirtualCrewChecklistStep.AwaitingResponse);

    for (let i = 0; i < CockpitPreparationChecklist.items.length; i++) {
      runner.respond();
      run(5);
    }

    expect(speech).toEqual([
      'PF:cockpitPreparationChecklist',
      'PM:clGearPinsAndCovers',
      'PF:respRemoved',
      'PM:clFuelQuantity',
      'PF:respChecked',
      'PM:clSeatBelts',
      'PF:respOn',
      'PM:clBaroRef',
      'PF:respSetBoth',
      'PM:cockpitPreparationChecklistComplete',
    ]);
    expect(ecl.states.get(CockpitPreparationChecklist.eclId)!.procedureCompleted).toBe(true);
    expect(ecl.states.get(CockpitPreparationChecklist.eclId)!.itemsChecked).toEqual([true, true, true, true]);
    expect(runner.running).toBe(false);
    expect(runner.takeCompleted()).toBe(CockpitPreparationChecklist);
  });

  it('waits for the response of the pilot flying before going on', () => {
    collect(runner.start(CockpitPreparationChecklist, now));
    run(20);
    expect(speech).toEqual(['PF:cockpitPreparationChecklist', 'PM:clGearPinsAndCovers']);
    expect(runner.awaitingResponse).toBe(true);
  });

  it('asks to check a sensed item which is not met and continues once corrected', () => {
    collect(runner.start(CockpitPreparationChecklist, now));
    run(5);
    runner.respond(); // gear pins
    run(5);
    runner.respond(); // fuel quantity
    run(5);

    // seat belts are off
    runner.respond();
    run(5);
    expect(speech.slice(-2)).toEqual(['PF:respOn', 'PM:pleaseCheck']);
    expect(runner.currentStep).toBe(VirtualCrewChecklistStep.Discrepancy);

    // the pilot flying switches the seat belts on and responds again
    ecl.setSensed(CockpitPreparationChecklist.eclId, 2, true);
    runner.respond();
    run(5);
    expect(speech.slice(-2)).toEqual(['PF:respOn', 'PM:clBaroRef']);
  });

  it('goes on once a discrepancy is corrected, without a new response', () => {
    vars['L:A32NX_PARK_BRAKE_LEVER_POS'] = 1;
    collect(runner.start(BeforeStartChecklist, now));
    run(5);
    runner.respond(); // parking brake
    run(5);
    runner.respond(); // T.O speeds: not inserted
    run(5);
    expect(speech.slice(-1)).toEqual(['PM:pleaseCheck']);

    vars['L:AIRLINER_V1_SPEED'] = 140;
    vars['L:AIRLINER_VR_SPEED'] = 145;
    vars['L:AIRLINER_V2_SPEED'] = 150;
    run(5);
    expect(speech.slice(-1)).toEqual(['PM:clBeacon']);
  });

  it('accepts a sensed item seen in the cockpit before the ECL shows it', () => {
    vars['L:A32NX_PARK_BRAKE_LEVER_POS'] = 1;
    vars['L:AIRLINER_V1_SPEED'] = 140;
    vars['L:AIRLINER_VR_SPEED'] = 145;
    vars['L:AIRLINER_V2_SPEED'] = 150;
    // the beacon is on, the ECL state is not updated yet
    vars['A:LIGHT BEACON'] = 1;
    collect(runner.start(BeforeStartChecklist, now));
    run(5);
    runner.respond(); // parking brake
    run(5);
    runner.respond(); // T.O speeds
    run(5);
    runner.respond(); // beacon
    run(5);
    expect(speech).not.toContain('PM:pleaseCheck');
    expect(speech.slice(-2)).toEqual(['PF:respOn', 'PM:beforeStartChecklistComplete']);
  });

  it('verifies the non sensed items it can see', () => {
    collect(runner.start(BeforeStartChecklist, now));
    run(5);
    runner.respond(); // parking brake released
    run(5);
    expect(speech.slice(-1)).toEqual(['PM:pleaseCheck']);

    vars['L:A32NX_PARK_BRAKE_LEVER_POS'] = 1;
    runner.respond();
    run(5);
    expect(speech.slice(-1)).toEqual(['PM:clTakeoffSpeedsAndThrust']);
    expect(ecl.states.get(BeforeStartChecklist.eclId)!.itemsChecked[0]).toBe(true);
  });

  it('opens the right checklist from the ECL menu', () => {
    // the cockpit preparation is completed, the menu selects the before start checklist
    ecl.states.get(CockpitPreparationChecklist.eclId)!.procedureCompleted = true;
    collect(runner.start(BeforeStartChecklist, now));
    run(5);
    expect(presses).toEqual(['CL', 'CHECK']);
    expect(ecl.checklistId).toBe(BeforeStartChecklist.eclId);
  });

  it('navigates in the ECL menu when another checklist is selected', () => {
    collect(runner.start(BeforeStartChecklist, now));
    run(5);
    expect(presses).toEqual(['CL', 'DOWN', 'CHECK']);
    expect(ecl.checklistId).toBe(BeforeStartChecklist.eclId);
  });

  it('closes another displayed checklist first', () => {
    ecl.shown = true;
    ecl.checklistId = 1000003;
    ecl.states.set(1000003, { itemsChecked: [false], procedureCompleted: false });
    ecl.sensed.set(1000003, [null]);
    collect(runner.start(CockpitPreparationChecklist, now));
    run(5);
    expect(presses.slice(0, 2)).toEqual(['CL', 'CL']);
    expect(ecl.checklistId).toBe(CockpitPreparationChecklist.eclId);
  });

  it('gives up when the ECL does not react, e.g. not powered', () => {
    ecl.frozen = true;
    collect(runner.start(CockpitPreparationChecklist, now));
    run(60);
    expect(runner.currentStep).toBe(VirtualCrewChecklistStep.Failed);
    expect(runner.running).toBe(false);
  });

  describe('availability', () => {
    let manager: ChecklistManager;

    beforeEach(() => {
      manager = new ChecklistManager();
    });

    it('offers the cockpit preparation checklist after the takeoff briefing', () => {
      expect(manager.available({ phase: VirtualCrewFlightPhase.Preflight, briefingDone: false })).toBeUndefined();
      expect(manager.available({ phase: VirtualCrewFlightPhase.Preflight, briefingDone: true })).toBe(
        CockpitPreparationChecklist,
      );
    });

    it('offers the before start checklist after the cockpit preparation, once the preflight is over', () => {
      const preflight = { phase: VirtualCrewFlightPhase.Preflight, briefingDone: true };
      collect(manager.request(preflight, now)!);
      for (let i = 0; i < CockpitPreparationChecklist.items.length + 1; i++) {
        ecl.setSensed(CockpitPreparationChecklist.eclId, 2, true);
        manager.runner.respond();
        for (let t = 0; t < 50; t++) {
          now += 100;
          collect(manager.update(now, ecl.state, read));
        }
      }
      expect(manager.isDone('cockpitPreparation')).toBe(true);

      // still in the preflight: nothing to request
      expect(manager.available(preflight)).toBeUndefined();
      expect(manager.available({ phase: VirtualCrewFlightPhase.BeforeStart, briefingDone: true })).toBe(
        BeforeStartChecklist,
      );
    });

    it('forgets the checklists of the previous flight', () => {
      manager.reset();
      expect(manager.isDone('cockpitPreparation')).toBe(false);
    });
  });
});
