// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { describe, expect, it } from 'vitest';
import { CrewAction, SimVarReader } from '../VirtualCrewTypes';
import { InitialPowerUpWorkflow } from './InitialPowerUpWorkflow';
import { Workflow } from './Workflow';
import { WorkflowRunner } from './WorkflowRunner';

/**
 * Performs a workflow until its end
 * @param workflow the workflow
 * @param read the aircraft state
 * @returns the actions and the duration of the workflow in milliseconds
 */
function perform(workflow: Workflow, read: SimVarReader): { actions: CrewAction[]; durationMs: number } {
  const runner = new WorkflowRunner();
  const actions: CrewAction[] = [];
  let now = 0;
  runner.start(workflow, now);
  while (runner.busy) {
    now += 100;
    actions.push(...runner.update(now, read));
  }
  return { actions, durationMs: now };
}

const setVars = (actions: CrewAction[]) =>
  actions.map((action) => (action.type === 'SET_LOCAL_VAR' ? `${action.name}=${action.value}` : action.type));

describe('virtual crew workflows', () => {
  it('performs the items at a human pace and one workflow after the other', () => {
    const a: Workflow = {
      id: 'a',
      seat: 'FO',
      steps: [{ item: 'A', durationMs: 1000, actions: [{ type: 'GEAR_UP' }] }],
    };
    const b: Workflow = {
      id: 'b',
      seat: 'FO',
      steps: [{ item: 'B', durationMs: 1000, actions: [{ type: 'FLAPS_SET', index: 0 }] }],
    };
    const runner = new WorkflowRunner();
    runner.start(a, 0);
    runner.start(b, 0);

    expect(runner.update(999, () => 0)).toEqual([]);
    expect(runner.currentWorkflowId).toBe('a');
    expect(runner.update(1000, () => 0)).toEqual([{ type: 'GEAR_UP' }]);
    expect(runner.currentWorkflowId).toBe('b');
    expect(runner.update(2000, () => 0)).toEqual([{ type: 'FLAPS_SET', index: 0 }]);
    expect(runner.busy).toBe(false);
  });

  describe('initial power up (SOP p. 3)', () => {
    it('switches the batteries on and connects the available external power in the order 2, 3, 1, 4', () => {
      const available = ['L:A32NX_EXT_PWR_AVAIL:1', 'L:A32NX_EXT_PWR_AVAIL:2', 'L:A32NX_EXT_PWR_AVAIL:3'];
      const { actions, durationMs } = perform(InitialPowerUpWorkflow, (name) => (available.includes(name) ? 1 : 0));

      expect(setVars(actions)).toEqual([
        'L:A32NX_OVHD_ELEC_BAT_1_PB_IS_AUTO=1',
        'L:A32NX_OVHD_ELEC_BAT_ESS_PB_IS_AUTO=1',
        'L:A32NX_OVHD_ELEC_BAT_2_PB_IS_AUTO=1',
        'L:A32NX_OVHD_ELEC_BAT_APU_PB_IS_AUTO=1',
        'L:A32NX_OVHD_ELEC_EXT_PWR_2_PB_IS_ON=1',
        'L:A32NX_OVHD_ELEC_EXT_PWR_3_PB_IS_ON=1',
        'L:A32NX_OVHD_ELEC_EXT_PWR_1_PB_IS_ON=1',
      ]);
      // a realistic duration, far below the 40 minutes of the preflight
      expect(durationMs).toBeGreaterThan(15_000);
      expect(durationMs).toBeLessThan(60_000);
    });

    it('leaves the switches which are already set', () => {
      const { actions } = perform(InitialPowerUpWorkflow, (name) =>
        name.startsWith('L:A32NX_OVHD_ELEC_BAT_') ? 1 : 0,
      );
      expect(actions).toEqual([]);
    });
  });
});
