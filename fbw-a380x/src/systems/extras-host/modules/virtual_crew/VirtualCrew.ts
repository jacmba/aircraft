// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import {
  ConsumerSubject,
  EventBus,
  Instrument,
  KeyEventData,
  KeyEventManager,
  KeyEvents,
  SimVarValueType,
} from '@microsoft/msfs-sdk';
import { NXDataStore, PilotSeat, PilotSeatEvents } from '@flybywiresim/fbw-sdk';
import {
  VirtualCrewButtonEvents,
  VirtualCrewButtonLocalVars,
  VirtualCrewChecklists,
  VirtualCrewChecklistStep,
  VirtualCrewCommand,
  VirtualCrewCommandLocalVar,
  VirtualCrewDefaults,
  VirtualCrewFlightPhase,
  VirtualCrewSettingKeys,
  VirtualCrewStatusLocalVars,
  VirtualCrewVoices,
  VirtualCrewWorkflows,
} from '../../../shared/src/VirtualCrew';
import { ProcedureState, VirtualCrewEngine } from './VirtualCrewEngine';
import { FlightPhaseContext, FlightPhaseManager } from './FlightPhaseManager';
import { TakeoffProcedure } from './procedures/TakeoffProcedure';
import { AircraftSnapshot, CrewAction, CrewInput, CrewOutput, CrewRole, CrewSeat, CrewVoice } from './VirtualCrewTypes';
import { VoicePlayer } from './VoicePlayer';
import { ChecklistContext, ChecklistManager } from './checklists/ChecklistManager';
import { ChecklistOutput, EclState, EcpButton } from './checklists/ChecklistRunner';

/** Events of the FWS describing the ECL (see FwsEvents of the EWD) */
interface FwsEclEvents {
  fws_show_normal_checklists: boolean;
  fws_normal_checklists_id: number;
  fws_active_item: number;
  fws_normal_checklists: { id: string; itemsChecked: boolean[]; procedureCompleted: boolean }[];
}

/** Local variables of the buttons of the ECAM control panel */
const EcpButtonLocalVars: Record<Exclude<EcpButton, 'CHECK'>, string> = {
  CL: 'L:A32NX_BTN_CL',
  UP: 'L:A32NX_BTN_UP',
  DOWN: 'L:A32NX_BTN_DOWN',
};

/** Time an ECAM control panel button is held, in milliseconds (the FWS reacts to the rising edge) */
const ECP_BUTTON_PRESS_MS = 150;

/** Speed above which the takeoff roll is considered started, in knots */
const TAKEOFF_ROLL_SPEED = 30;

/** Thrust lever angle of the FLX/MCT detent, in degrees */
const FLX_MCT_DETENT_TLA = 35;

/** Interval between two evaluations of the procedures, in milliseconds */
const UPDATE_INTERVAL_MS = 100;

/** Delay between two steps of the flaps lever moved by the pilot monitoring, in milliseconds */
const FLAPS_LEVER_STEP_DELAY_MS = 400;

/**
 * Virtual crew of the A380X in the button mode: the user is the pilot flying, the virtual crew member the pilot
 * monitoring. The behaviour follows the FBW A380X SOP, see the procedures folder.
 *
 * Inputs: the sim events selected as primary and secondary buttons in the flyPad, or the local variables
 * {@link VirtualCrewButtonLocalVars}.
 */
export class VirtualCrew implements Instrument {
  private readonly engine = new VirtualCrewEngine(TakeoffProcedure);

  private readonly phases = new FlightPhaseManager();

  private readonly checklists = new ChecklistManager();

  /** State of the ECL, as published by the FWS */
  private readonly ecl: EclState & {
    checklists: Map<number, { itemsChecked: boolean[]; procedureCompleted: boolean }>;
  } = {
    shown: false,
    checklistId: 0,
    selectedLine: 0,
    checklists: new Map(),
  };

  /** Last published values of the status local variables */
  private readonly publishedStatus = new Map<string, number>();

  private readonly player = new VoicePlayer((wwiseEvent) =>
    Coherent.call('PLAY_INSTRUMENT_SOUND', wwiseEvent).catch(console.error),
  );

  private lastEvaluation = 0;

  private readonly pilotSeat = ConsumerSubject.create(
    this.bus.getSubscriber<PilotSeatEvents>().on('pilot_seat'),
    PilotSeat.Left,
  );

  private enabled = false;

  private readonly voices: Record<CrewSeat, CrewVoice> = {
    CAPT: VirtualCrewDefaults.captainVoice,
    FO: VirtualCrewDefaults.firstOfficerVoice,
  };

  private primaryButtonEvent: string = VirtualCrewDefaults.primaryButtonEvent;

  private secondaryButtonEvent: string = VirtualCrewDefaults.secondaryButtonEvent;

  /** Inputs received since the last update, processed with a consistent aircraft state */
  private readonly pendingInputs: CrewInput[] = [];

  constructor(private readonly bus: EventBus) {}

  public init(): void {
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewSettingKeys.Enabled,
      (_, value) => {
        this.enabled = value === '1';
        if (!this.enabled) {
          this.player.clear();
        }
      },
      VirtualCrewDefaults.enabled,
    );
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewSettingKeys.CaptainVoice,
      (_, value) => (this.voices.CAPT = VirtualCrew.toVoice(value, VirtualCrewDefaults.captainVoice)),
      VirtualCrewDefaults.captainVoice,
    );
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewSettingKeys.FirstOfficerVoice,
      (_, value) => (this.voices.FO = VirtualCrew.toVoice(value, VirtualCrewDefaults.firstOfficerVoice)),
      VirtualCrewDefaults.firstOfficerVoice,
    );
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewSettingKeys.PrimaryButtonEvent,
      (_, value) => (this.primaryButtonEvent = value ?? VirtualCrewDefaults.primaryButtonEvent),
      VirtualCrewDefaults.primaryButtonEvent,
    );
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewSettingKeys.SecondaryButtonEvent,
      (_, value) => (this.secondaryButtonEvent = value ?? VirtualCrewDefaults.secondaryButtonEvent),
      VirtualCrewDefaults.secondaryButtonEvent,
    );

    // the events have no function in the A380X, they are always intercepted and only used if selected
    KeyEventManager.getManager(this.bus).then((manager) => {
      VirtualCrewButtonEvents.forEach((event) => manager.interceptKey(event, false));
    });
    this.bus
      .getSubscriber<KeyEvents>()
      .on('key_intercept')
      .handle((data) => this.onKeyIntercepted(data));

    const fws = this.bus.getSubscriber<FwsEclEvents>();
    fws.on('fws_show_normal_checklists').handle((shown) => (this.ecl.shown = shown));
    fws.on('fws_normal_checklists_id').handle((id) => (this.ecl.checklistId = id));
    fws.on('fws_active_item').handle((line) => (this.ecl.selectedLine = line));
    fws.on('fws_normal_checklists').handle((checklists) => {
      this.ecl.checklists.clear();
      checklists.forEach((checklist) =>
        this.ecl.checklists.set(parseInt(checklist.id), {
          itemsChecked: checklist.itemsChecked,
          procedureCompleted: checklist.procedureCompleted,
        }),
      );
    });
  }

  public onUpdate(): void {
    const now = Date.now();
    this.player.update(now);

    if (now - this.lastEvaluation < UPDATE_INTERVAL_MS) {
      return;
    }
    this.lastEvaluation = now;

    this.readButtonLocalVars();

    if (!this.enabled || SimVar.GetSimVarValue('L:A32NX_IS_READY', SimVarValueType.Number) !== 1) {
      this.pendingInputs.length = 0;
      return;
    }

    const aircraft = VirtualCrew.readAircraft();

    for (const input of this.pendingInputs.splice(0)) {
      if (!this.handleChecklistInput(input, aircraft, now)) {
        this.execute(this.engine.input(input, aircraft));
      }
    }
    this.execute(this.engine.update(aircraft));

    this.updatePhases(aircraft, now);
    this.executeChecklist(this.checklists.update(now, this.ecl, VirtualCrew.read));
  }

  private get checklistContext(): ChecklistContext {
    return { phase: this.phases.phase, briefingDone: this.phases.status.briefingDone };
  }

  /**
   * The buttons first serve the checklists: the primary button requests the available checklist or responds to the
   * current item, the secondary button stops the checklist being read
   * @returns true if the input was used by the checklists
   */
  private handleChecklistInput(input: CrewInput, aircraft: AircraftSnapshot, now: number): boolean {
    const runner = this.checklists.runner;
    if (runner.running) {
      if (input === 'PRIMARY') {
        runner.respond();
      } else {
        runner.cancel();
      }
      return true;
    }

    if (input === 'PRIMARY' && aircraft.onGround) {
      const output = this.checklists.request(this.checklistContext, now);
      if (output) {
        this.executeChecklist(output);
        return true;
      }
    }

    // no takeoff call during the preparation of the flight
    const phase = this.phases.phase;
    return phase === VirtualCrewFlightPhase.Preflight || phase === VirtualCrewFlightPhase.TakeoffBriefing;
  }

  private executeChecklist(output: ChecklistOutput): void {
    output.speech.forEach((speech) => this.player.enqueue({ voice: this.voiceOf(speech.role), line: speech.line }));
    output.presses.forEach((button) => this.pressEcpButton(button));
  }

  /** Presses a button of the ECAM control panel, the CHECK button on the side of the pilot monitoring */
  private pressEcpButton(button: EcpButton): void {
    const name =
      button === 'CHECK'
        ? this.virtualSeat === 'FO'
          ? 'L:A32NX_BTN_CHECK_RH'
          : 'L:A32NX_BTN_CHECK_LH'
        : EcpButtonLocalVars[button];
    SimVar.SetSimVarValue(name, SimVarValueType.Bool, 1);
    setTimeout(() => SimVar.SetSimVarValue(name, SimVarValueType.Bool, 0), ECP_BUTTON_PRESS_MS);
  }

  private get virtualSeat(): CrewSeat {
    return this.pilotSeat.get() === PilotSeat.Right ? 'CAPT' : 'FO';
  }

  private static read(name: string): number {
    return SimVar.GetSimVarValue(name, SimVarValueType.Number);
  }

  private updatePhases(aircraft: AircraftSnapshot, now: number): void {
    const context: FlightPhaseContext = {
      // simulation time, so that the preflight does not advance while the simulation is paused
      now: SimVar.GetSimVarValue('E:SIMULATION TIME', SimVarValueType.Seconds) * 1000,
      read: VirtualCrew.read,
      virtualSeat: this.virtualSeat,
      onGround: aircraft.onGround,
      takeoffRollStarted:
        aircraft.onGround && aircraft.thrustLeversInTakeoffPosition && aircraft.indicatedAirspeed >= TAKEOFF_ROLL_SPEED,
      takeoffProcedureCompleted: this.engine.currentState === ProcedureState.Completed,
      crewBusy: this.checklists.runner.running,
    };

    const command = SimVar.GetSimVarValue(VirtualCrewCommandLocalVar, SimVarValueType.Number) as VirtualCrewCommand;
    if (command !== VirtualCrewCommand.None) {
      SimVar.SetSimVarValue(VirtualCrewCommandLocalVar, SimVarValueType.Number, VirtualCrewCommand.None);
      if (command === VirtualCrewCommand.RequestChecklist) {
        const output = this.checklists.request(this.checklistContext, now);
        if (output) {
          this.executeChecklist(output);
        }
      } else if (!this.phases.command(command, context)) {
        console.log(`[VirtualCrew] command ${command} not possible in phase ${this.phases.phase}`);
      }
    }

    const previousPhase = this.phases.phase;
    this.phases.update(context).forEach((action) => this.perform(action));
    if (this.phases.phase === VirtualCrewFlightPhase.Idle && previousPhase !== VirtualCrewFlightPhase.Idle) {
      // the flight is over or has been ended, the checklists start again with the next flight
      this.checklists.reset();
    }

    const status = this.phases.status;
    const workflowIndex = VirtualCrewWorkflows.findIndex((workflow) => workflow.id === status.workflowId);
    this.publish(VirtualCrewStatusLocalVars.Phase, status.phase);
    this.publish(VirtualCrewStatusLocalVars.PreflightRemaining, status.preflightRemainingS);
    this.publish(VirtualCrewStatusLocalVars.Accelerated, status.accelerated ? 1 : 0);
    this.publish(VirtualCrewStatusLocalVars.Workflow, workflowIndex + 1);
    this.publish(VirtualCrewStatusLocalVars.BriefingDone, status.briefingDone ? 1 : 0);

    const runner = this.checklists.runner;
    const checklistIndex = (id: string | undefined) =>
      VirtualCrewChecklists.findIndex((checklist) => checklist.id === id) + 1;
    this.publish(
      VirtualCrewStatusLocalVars.ChecklistAvailable,
      checklistIndex(this.checklists.available(this.checklistContext)?.id),
    );
    this.publish(VirtualCrewStatusLocalVars.ChecklistRunning, checklistIndex(runner.currentChecklist?.id));
    this.publish(VirtualCrewStatusLocalVars.ChecklistItem, runner.running ? runner.currentItemIndex : -1);
    this.publish(
      VirtualCrewStatusLocalVars.ChecklistStep,
      runner.currentChecklist || runner.currentStep === VirtualCrewChecklistStep.Failed
        ? runner.currentStep
        : VirtualCrewChecklistStep.None,
    );
    this.publish(
      VirtualCrewStatusLocalVars.ChecklistsDone,
      VirtualCrewChecklists.reduce(
        (bits, checklist, i) => bits | (this.checklists.isDone(checklist.id) ? 1 << i : 0),
        0,
      ),
    );
  }

  /** Writes a status local variable when its value changed */
  private publish(name: string, value: number): void {
    if (this.publishedStatus.get(name) !== value) {
      this.publishedStatus.set(name, value);
      SimVar.SetSimVarValue(name, SimVarValueType.Number, value);
    }
  }

  private onKeyIntercepted(data: KeyEventData): void {
    if (data.key === this.primaryButtonEvent) {
      this.pendingInputs.push('PRIMARY');
    } else if (data.key === this.secondaryButtonEvent) {
      this.pendingInputs.push('SECONDARY');
    }
  }

  private readButtonLocalVars(): void {
    if (SimVar.GetSimVarValue(VirtualCrewButtonLocalVars.Primary, SimVarValueType.Number) !== 0) {
      SimVar.SetSimVarValue(VirtualCrewButtonLocalVars.Primary, SimVarValueType.Number, 0);
      this.pendingInputs.push('PRIMARY');
    }
    if (SimVar.GetSimVarValue(VirtualCrewButtonLocalVars.Secondary, SimVarValueType.Number) !== 0) {
      SimVar.SetSimVarValue(VirtualCrewButtonLocalVars.Secondary, SimVarValueType.Number, 0);
      this.pendingInputs.push('SECONDARY');
    }
  }

  private execute(output: CrewOutput): void {
    // the pilot monitoring acts while confirming the order, or right away without confirmation
    let actionsPending = output.actions.length > 0;
    for (const speech of output.speech) {
      const withActions = actionsPending && speech.role === 'PM';
      this.player.enqueue({
        voice: this.voiceOf(speech.role),
        line: speech.line,
        onStart: withActions ? () => output.actions.forEach((action) => this.perform(action)) : undefined,
      });
      actionsPending = actionsPending && !withActions;
    }
    if (actionsPending) {
      output.actions.forEach((action) => this.perform(action));
    }
  }

  private perform(action: CrewAction): void {
    switch (action.type) {
      case 'GEAR_UP':
        SimVar.SetSimVarValue('K:GEAR_UP', SimVarValueType.Number, 0);
        break;
      case 'SET_LOCAL_VAR':
        SimVar.SetSimVarValue(action.name, SimVarValueType.Number, action.value);
        break;
      case 'KEY_EVENT':
        SimVar.SetSimVarValue(`K:${action.name}`, SimVarValueType.Number, action.value ?? 0);
        break;
      case 'FLAPS_SET': {
        // the flaps lever is moved one detent after the other
        const current = SimVar.GetSimVarValue('L:A32NX_FLAPS_HANDLE_INDEX', SimVarValueType.Number);
        const event = current > action.index ? 'K:FLAPS_DECR' : 'K:FLAPS_INCR';
        for (let step = 0; step < Math.abs(current - action.index); step++) {
          setTimeout(() => SimVar.SetSimVarValue(event, SimVarValueType.Number, 0), step * FLAPS_LEVER_STEP_DELAY_MS);
        }
        break;
      }
    }
  }

  /** The user is the pilot flying, seated where the camera is */
  private voiceOf(role: CrewRole): CrewVoice {
    const otherSeat = this.virtualSeat;
    const userSeat: CrewSeat = otherSeat === 'CAPT' ? 'FO' : 'CAPT';
    return this.voices[role === 'PF' ? userSeat : otherSeat];
  }

  private static toVoice(value: string | undefined, fallback: CrewVoice): CrewVoice {
    return (VirtualCrewVoices as readonly string[]).includes(value ?? '') ? (value as CrewVoice) : fallback;
  }

  private static readAircraft(): AircraftSnapshot {
    const tla = [1, 2, 3, 4].map((engine) =>
      SimVar.GetSimVarValue(`L:A32NX_AUTOTHRUST_TLA:${engine}`, SimVarValueType.Number),
    );

    return {
      onGround: SimVar.GetSimVarValue('SIM ON GROUND', SimVarValueType.Bool) === 1,
      indicatedAirspeed: SimVar.GetSimVarValue('AIRSPEED INDICATED', SimVarValueType.Knots),
      groundSpeed: SimVar.GetSimVarValue('GROUND VELOCITY', SimVarValueType.Knots),
      radioAltitude: SimVar.GetSimVarValue('RADIO HEIGHT', SimVarValueType.Feet),
      verticalSpeed: SimVar.GetSimVarValue('VERTICAL SPEED', SimVarValueType.FPM),
      v1: SimVar.GetSimVarValue('L:AIRLINER_V1_SPEED', SimVarValueType.Knots),
      vr: SimVar.GetSimVarValue('L:AIRLINER_VR_SPEED', SimVarValueType.Knots),
      fSpeed: SimVar.GetSimVarValue('L:A32NX_SPEEDS_F', SimVarValueType.Number),
      sSpeed: SimVar.GetSimVarValue('L:A32NX_SPEEDS_S', SimVarValueType.Number),
      thrustLeversInTakeoffPosition: tla.every((angle) => angle >= FLX_MCT_DETENT_TLA),
      gearLeverUp: SimVar.GetSimVarValue('L:A32NX_GEAR_HANDLE_POSITION', SimVarValueType.Number) < 0.5,
      flapsLeverIndex: SimVar.GetSimVarValue('L:A32NX_FLAPS_HANDLE_INDEX', SimVarValueType.Number),
    };
  }
}
