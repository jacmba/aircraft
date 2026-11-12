// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { beforeEach, describe, expect, it } from 'vitest';
import {
  VIRTUAL_CREW_PREFLIGHT_ACCELERATION,
  VIRTUAL_CREW_PREFLIGHT_DURATION_S,
  VirtualCrewCommand,
  VirtualCrewFlightPhase,
} from '../../../shared/src/VirtualCrew';
import { FlightPhaseContext, FlightPhaseManager } from './FlightPhaseManager';
import { Workflow } from './workflows/Workflow';

/** A workflow of the first officer taking 10 seconds */
const tenSecondsWorkflow: Workflow = {
  id: 'test',
  seat: 'FO',
  steps: [
    { item: 'A', durationMs: 5000, actions: [{ type: 'SET_LOCAL_VAR', name: 'L:A', value: 1 }] },
    { item: 'B', durationMs: 5000, actions: [{ type: 'SET_LOCAL_VAR', name: 'L:B', value: 1 }] },
  ],
};

describe('virtual crew flight phases', () => {
  let manager: FlightPhaseManager;
  let now: number;

  /**
   * Creates the context of an update
   * @param changes the values which differ from a parked aircraft with the user as captain
   * @returns the context
   */
  const context = (changes: Partial<FlightPhaseContext> = {}): FlightPhaseContext => ({
    now,
    read: () => 0,
    virtualSeat: 'FO',
    onGround: true,
    takeoffRollStarted: false,
    takeoffProcedureCompleted: false,
    ...changes,
  });

  /**
   * Lets the time pass in steps of one second
   * @param seconds the time to pass
   * @param changes changes of the context
   */
  const run = (seconds: number, changes: Partial<FlightPhaseContext> = {}) => {
    for (let i = 0; i < seconds; i++) {
      now += 1000;
      manager.update(context(changes));
    }
  };

  beforeEach(() => {
    manager = new FlightPhaseManager({ [VirtualCrewFlightPhase.Preflight]: [tenSecondsWorkflow] });
    now = 0;
    manager.update(context());
  });

  it('starts idle', () => {
    expect(manager.phase).toBe(VirtualCrewFlightPhase.Idle);
  });

  it('counts down the 40 minutes of the preflight, then starts the takeoff briefing', () => {
    expect(manager.command(VirtualCrewCommand.StartPreflight, context())).toBe(true);
    expect(manager.status.preflightRemainingS).toBe(VIRTUAL_CREW_PREFLIGHT_DURATION_S);

    run(60);
    expect(manager.status.preflightRemainingS).toBe(VIRTUAL_CREW_PREFLIGHT_DURATION_S - 60);
    expect(manager.phase).toBe(VirtualCrewFlightPhase.Preflight);

    run(VIRTUAL_CREW_PREFLIGHT_DURATION_S - 60);
    expect(manager.phase).toBe(VirtualCrewFlightPhase.TakeoffBriefing);
  });

  it('performs the workflows of the virtual crew member during the preflight', () => {
    manager.command(VirtualCrewCommand.StartPreflight, context());
    expect(manager.busy).toBe(true);

    now += 5000;
    expect(manager.update(context())).toEqual([{ type: 'SET_LOCAL_VAR', name: 'L:A', value: 1 }]);
    expect(manager.status.workflowId).toBe('test');

    now += 5000;
    expect(manager.update(context())).toEqual([{ type: 'SET_LOCAL_VAR', name: 'L:B', value: 1 }]);
    expect(manager.busy).toBe(false);
  });

  it('leaves the workflows of the seat of the user to the user', () => {
    manager.command(VirtualCrewCommand.StartPreflight, context({ virtualSeat: 'CAPT' }));
    expect(manager.busy).toBe(false);
  });

  it('accelerates the countdown only while nobody performs a workflow', () => {
    manager.command(VirtualCrewCommand.StartPreflight, context());

    // the first officer is busy: no acceleration
    expect(manager.command(VirtualCrewCommand.ToggleAcceleration, context())).toBe(false);
    run(10);
    expect(manager.busy).toBe(false);

    expect(manager.command(VirtualCrewCommand.ToggleAcceleration, context())).toBe(true);
    expect(manager.status.accelerated).toBe(true);
    const before = manager.status.preflightRemainingS;
    run(10);
    expect(manager.status.preflightRemainingS).toBe(before - 10 * VIRTUAL_CREW_PREFLIGHT_ACCELERATION);

    // a second click returns to the normal pace
    manager.command(VirtualCrewCommand.ToggleAcceleration, context());
    run(10);
    expect(manager.status.preflightRemainingS).toBe(before - 10 * VIRTUAL_CREW_PREFLIGHT_ACCELERATION - 10);
  });

  it('completes an accelerated preflight in 40 minutes / acceleration factor', () => {
    const quiet = new FlightPhaseManager({});
    quiet.update(context());
    quiet.command(VirtualCrewCommand.StartPreflight, context());
    quiet.command(VirtualCrewCommand.ToggleAcceleration, context());
    for (let i = 0; i < VIRTUAL_CREW_PREFLIGHT_DURATION_S / VIRTUAL_CREW_PREFLIGHT_ACCELERATION; i++) {
      now += 1000;
      quiet.update(context());
    }
    expect(quiet.phase).toBe(VirtualCrewFlightPhase.TakeoffBriefing);
  });

  it('does not let a jump of the simulation time end the preflight', () => {
    manager.command(VirtualCrewCommand.StartPreflight, context());
    now += 3_600_000;
    manager.update(context());
    expect(manager.phase).toBe(VirtualCrewFlightPhase.Preflight);
  });

  it('allows to skip the preflight and start with the takeoff briefing', () => {
    expect(manager.command(VirtualCrewCommand.StartTakeoffBriefing, context())).toBe(true);
    expect(manager.phase).toBe(VirtualCrewFlightPhase.TakeoffBriefing);
    expect(manager.busy).toBe(false);
  });

  it('allows to end the preflight early only while nobody is busy', () => {
    manager.command(VirtualCrewCommand.StartPreflight, context());
    expect(manager.command(VirtualCrewCommand.StartTakeoffBriefing, context())).toBe(false);
    run(10);
    expect(manager.command(VirtualCrewCommand.StartTakeoffBriefing, context())).toBe(true);
  });

  it('continues with the SOP chapter after the takeoff briefing', () => {
    manager.command(VirtualCrewCommand.StartTakeoffBriefing, context());
    expect(manager.command(VirtualCrewCommand.CompleteTakeoffBriefing, context())).toBe(true);
    expect(manager.phase).toBe(VirtualCrewFlightPhase.BeforeStart);
  });

  it('detects the takeoff from any ground phase, also without preflight and briefing', () => {
    run(1, { takeoffRollStarted: true });
    expect(manager.phase).toBe(VirtualCrewFlightPhase.Takeoff);

    run(1, { onGround: false, takeoffProcedureCompleted: true });
    expect(manager.phase).toBe(VirtualCrewFlightPhase.AfterTakeoff);

    run(1, { onGround: true });
    expect(manager.phase).toBe(VirtualCrewFlightPhase.Idle);
  });

  it('cancels the workflows when the flight is reset', () => {
    manager.command(VirtualCrewCommand.StartPreflight, context());
    manager.command(VirtualCrewCommand.Reset, context());
    expect(manager.phase).toBe(VirtualCrewFlightPhase.Idle);
    expect(manager.busy).toBe(false);
    expect(manager.status.preflightRemainingS).toBe(0);
  });

  it('does not start a preflight in flight', () => {
    expect(manager.command(VirtualCrewCommand.StartPreflight, context({ onGround: false }))).toBe(false);
  });
});
