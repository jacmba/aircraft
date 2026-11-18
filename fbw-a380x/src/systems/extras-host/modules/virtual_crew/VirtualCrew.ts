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
  VirtualCrewCommand,
  VirtualCrewCommandLocalVar,
  VirtualCrewCommandParamLocalVar,
  VirtualCrewDefaults,
  VirtualCrewFlows,
  VirtualCrewNextActions,
  VirtualCrewPerformedBriefingKeys,
  VirtualCrewSettingKeys,
  VirtualCrewStatusLocalVars,
  VirtualCrewVoices,
  VirtualCrewWorkflows,
} from '../../../shared/src/VirtualCrew';
import { AircraftSnapshot, CrewAction, CrewRole, CrewSeat, CrewSpeech, CrewVoice } from './VirtualCrewTypes';
import { VoicePlayer } from './VoicePlayer';
import { EclState, EcpButton } from './checklists/ChecklistRunner';
import { CoreContext, CoreOutput, VirtualCrewCore } from './VirtualCrewCore';
import {
  BriefingValues,
  BriefingVars,
  parseAntiIce,
  parseAutobrake,
  parseBriefingValues,
  parseLandingFlaps,
  parseTakeoffFlaps,
} from './briefing/BriefingData';

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

/** Time a momentary button is held, in milliseconds (the FWS and the systems react to the rising edge) */
const BUTTON_PRESS_MS = 150;

/**
 * Lowest thrust lever angle of the FLX/MCT detent, in degrees: the detent is at 35 degrees, the FWS accepts it from
 * 33.3 degrees (FwsFlightPhases)
 */
const FLX_MCT_DETENT_MIN_TLA = 33.3;

/** Number of thrust levers in the takeoff position for a takeoff, as for the FWS */
const TAKEOFF_THRUST_LEVERS = 2;

/** Interval between two evaluations of the crew, in milliseconds */
const UPDATE_INTERVAL_MS = 100;

/** Delay between two steps of the flaps lever moved by the pilot monitoring, in milliseconds */
const FLAPS_LEVER_STEP_DELAY_MS = 400;

/** Deviation of one dot of the localizer and of the glideslope, in degrees (as displayed on the PFD) */
const LOCALIZER_DOT_DEG = 0.8;
const GLIDESLOPE_DOT_DEG = 0.4;

/** The workflows and flows, in the order of the published workflow index */
const WORKFLOW_IDS: string[] = [...VirtualCrewWorkflows.map((w) => w.id), ...VirtualCrewFlows.map((f) => f.id)];

/**
 * Virtual crew of the A380X in the button mode: the user is the pilot flying, the virtual crew member the pilot
 * monitoring. The behaviour follows the FBW A380X SOP, see {@link VirtualCrewCore}. This module reads the aircraft,
 * handles the buttons and the commands of the flyPad, executes the actions and plays the phrases.
 *
 * Inputs: the sim events selected as primary and secondary buttons in the flyPad, or the local variables
 * {@link VirtualCrewButtonLocalVars}.
 */
export class VirtualCrew implements Instrument {
  private readonly core = new VirtualCrewCore();

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

  /** Briefing data as performed, read when the briefings are performed or the flows need them */
  private readonly briefings: Record<'takeoff' | 'approach', BriefingValues> = { takeoff: {}, approach: {} };

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
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewPerformedBriefingKeys.Takeoff,
      (_, value) => (this.briefings.takeoff = parseBriefingValues(value)),
      '{}',
    );
    NXDataStore.getAndSubscribeLegacy(
      VirtualCrewPerformedBriefingKeys.Approach,
      (_, value) => (this.briefings.approach = parseBriefingValues(value)),
      '{}',
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
      this.core.clearInputs();
      return;
    }

    const context = this.context(now);

    const command = SimVar.GetSimVarValue(VirtualCrewCommandLocalVar, SimVarValueType.Number) as VirtualCrewCommand;
    if (command !== VirtualCrewCommand.None) {
      SimVar.SetSimVarValue(VirtualCrewCommandLocalVar, SimVarValueType.Number, VirtualCrewCommand.None);
      const param = SimVar.GetSimVarValue(VirtualCrewCommandParamLocalVar, SimVarValueType.Number);
      const output = this.core.command(command, param, context);
      if (output) {
        this.execute(output);
      } else {
        console.log(`[VirtualCrew] command ${command} not possible in phase ${this.core.phase}`);
      }
    }

    this.execute(this.core.update(context));
    this.publishStatus(context.aircraft);
  }

  private context(now: number): CoreContext {
    return {
      now,
      // simulation time, so that the preflight does not advance while the simulation is paused
      simulationTime: SimVar.GetSimVarValue('E:SIMULATION TIME', SimVarValueType.Seconds) * 1000,
      aircraft: this.readAircraft(),
      ecl: this.ecl,
      read: this.read,
      virtualSeat: this.virtualSeat,
      readBriefing: (briefing) => this.briefings[briefing],
    };
  }

  private publishStatus(aircraft: AircraftSnapshot): void {
    const core = this.core;
    const status = core.phases.status;
    this.publish(VirtualCrewStatusLocalVars.Phase, status.phase);
    this.publish(VirtualCrewStatusLocalVars.PreflightRemaining, status.preflightRemainingS);
    this.publish(VirtualCrewStatusLocalVars.Accelerated, status.accelerated ? 1 : 0);
    this.publish(VirtualCrewStatusLocalVars.Workflow, WORKFLOW_IDS.indexOf(core.currentWorkflowId ?? '') + 1);
    this.publish(VirtualCrewStatusLocalVars.BriefingDone, status.briefingDone ? 1 : 0);
    this.publish(VirtualCrewStatusLocalVars.ApproachBriefingDone, status.approachBriefingDone ? 1 : 0);

    const runner = core.checklists.runner;
    const checklistIndex = (id: string | undefined) =>
      VirtualCrewChecklists.findIndex((checklist) => checklist.id === id) + 1;
    this.publish(VirtualCrewStatusLocalVars.ChecklistAvailable, checklistIndex(core.availableChecklist(aircraft)?.id));
    this.publish(VirtualCrewStatusLocalVars.ChecklistRunning, checklistIndex(runner.currentChecklist?.id));
    this.publish(VirtualCrewStatusLocalVars.ChecklistItem, runner.running ? runner.currentItemIndex : -1);
    this.publish(VirtualCrewStatusLocalVars.ChecklistStep, core.checklistStep);
    this.publish(
      VirtualCrewStatusLocalVars.ChecklistsDone,
      VirtualCrewChecklists.reduce(
        (bits, checklist, i) => bits | (core.checklists.isDone(checklist.id) ? 1 << i : 0),
        0,
      ),
    );
    this.publish(
      VirtualCrewStatusLocalVars.NextAction,
      Math.max(
        0,
        VirtualCrewNextActions.findIndex((action) => action.id === core.nextAction),
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
      this.core.input('PRIMARY');
    } else if (data.key === this.secondaryButtonEvent) {
      this.core.input('SECONDARY');
    }
  }

  private readButtonLocalVars(): void {
    if (SimVar.GetSimVarValue(VirtualCrewButtonLocalVars.Primary, SimVarValueType.Number) !== 0) {
      SimVar.SetSimVarValue(VirtualCrewButtonLocalVars.Primary, SimVarValueType.Number, 0);
      this.core.input('PRIMARY');
    }
    if (SimVar.GetSimVarValue(VirtualCrewButtonLocalVars.Secondary, SimVarValueType.Number) !== 0) {
      SimVar.SetSimVarValue(VirtualCrewButtonLocalVars.Secondary, SimVarValueType.Number, 0);
      this.core.input('SECONDARY');
    }
  }

  private execute(output: CoreOutput): void {
    // the pilot monitoring acts while confirming the order, or right away without confirmation
    let actionsPending = output.actions.length > 0;
    for (const speech of output.speech) {
      const withActions = actionsPending && speech.role === 'PM';
      this.enqueue(speech, withActions ? () => output.actions.forEach((action) => this.perform(action)) : undefined);
      actionsPending = actionsPending && !withActions;
    }
    if (actionsPending) {
      output.actions.forEach((action) => this.perform(action));
    }
    output.presses.forEach((button) => this.pressEcpButton(button));
  }

  private enqueue(speech: CrewSpeech, onStart?: () => void): void {
    this.player.enqueue({
      voice: this.voiceOf(speech.role),
      line: speech.line,
      pauseAfterMs: speech.pauseAfterMs,
      onStart,
    });
  }

  /** Presses a button of the ECAM control panel, the CHECK button on the side of the pilot monitoring */
  private pressEcpButton(button: EcpButton): void {
    const name =
      button === 'CHECK'
        ? this.virtualSeat === 'FO'
          ? 'L:A32NX_BTN_CHECK_RH'
          : 'L:A32NX_BTN_CHECK_LH'
        : EcpButtonLocalVars[button];
    VirtualCrew.pulse(name);
  }

  private static pulse(name: string): void {
    SimVar.SetSimVarValue(name, SimVarValueType.Bool, 1);
    setTimeout(() => SimVar.SetSimVarValue(name, SimVarValueType.Bool, 0), BUTTON_PRESS_MS);
  }

  private get virtualSeat(): CrewSeat {
    return this.pilotSeat.get() === PilotSeat.Right ? 'CAPT' : 'FO';
  }

  /** Reads a simulator variable, or a value of the briefings ({@link BriefingVars}) */
  private readonly read = (name: string): number => {
    switch (name) {
      case BriefingVars.AntiIce:
        return parseAntiIce(this.briefings.takeoff.A380X_VCREW_BRIEFING_ANTI_ICE);
      case BriefingVars.TakeoffFlaps:
        return parseTakeoffFlaps(this.briefings.takeoff.A380X_VCREW_BRIEFING_TO_FLAPS);
      case BriefingVars.Autobrake:
        return parseAutobrake(this.briefings.approach.A380X_VCREW_APPR_AUTOBRAKE);
      case BriefingVars.LandingFlaps:
        return parseLandingFlaps(this.briefings.approach.A380X_VCREW_APPR_LDG_FLAPS);
      default:
        return SimVar.GetSimVarValue(name, SimVarValueType.Number);
    }
  };

  private perform(action: CrewAction): void {
    switch (action.type) {
      case 'GEAR_UP':
        SimVar.SetSimVarValue('K:GEAR_UP', SimVarValueType.Number, 0);
        break;
      case 'GEAR_DOWN':
        SimVar.SetSimVarValue('K:GEAR_DOWN', SimVarValueType.Number, 0);
        break;
      case 'SET_LOCAL_VAR':
        SimVar.SetSimVarValue(action.name, SimVarValueType.Number, action.value);
        break;
      case 'PULSE_LOCAL_VAR':
        VirtualCrew.pulse(action.name);
        break;
      case 'KEY_EVENT':
        SimVar.SetSimVarValue(`K:${action.name}`, SimVarValueType.Number, action.value ?? 0);
        break;
      case 'BUS_EVENT':
        this.bus.getPublisher<Record<string, boolean | number>>().pub(action.topic, action.value, true);
        break;
      case 'SEAT_BELTS': {
        // the switch position and the signs, as the aircraft presets of the flyPad
        const on = SimVar.GetSimVarValue('A:CABIN SEATBELTS ALERT SWITCH', SimVarValueType.Bool) === 1;
        SimVar.SetSimVarValue(
          'L:XMLVAR_SWITCH_OVHD_INTLT_SEATBELT_Position',
          SimVarValueType.Number,
          action.on ? 0 : 2,
        );
        if (on !== action.on) {
          SimVar.SetSimVarValue('K:CABIN_SEATBELTS_ALERT_SWITCH_TOGGLE', SimVarValueType.Number, 1);
        }
        break;
      }
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

  private readAircraft(): AircraftSnapshot {
    const get = (name: string, unit: string = SimVarValueType.Number) => SimVar.GetSimVarValue(name, unit);
    const tla = [1, 2, 3, 4].map((engine) => get(`L:A32NX_AUTOTHRUST_TLA:${engine}`));
    const locValid = get('L:A32NX_RADIO_RECEIVER_LOC_IS_VALID') === 1;
    const gsValid = get('L:A32NX_RADIO_RECEIVER_GS_IS_VALID') === 1;

    return {
      onGround: get('SIM ON GROUND', SimVarValueType.Bool) === 1,
      indicatedAirspeed: get('AIRSPEED INDICATED', SimVarValueType.Knots),
      groundSpeed: get('GROUND VELOCITY', SimVarValueType.Knots),
      radioAltitude: get('RADIO HEIGHT', SimVarValueType.Feet),
      verticalSpeed: get('VERTICAL SPEED', SimVarValueType.FPM),
      v1: get('L:AIRLINER_V1_SPEED', SimVarValueType.Knots),
      vr: get('L:AIRLINER_VR_SPEED', SimVarValueType.Knots),
      fSpeed: get('L:A32NX_SPEEDS_F'),
      sSpeed: get('L:A32NX_SPEEDS_S'),
      thrustLeversInTakeoffPosition:
        tla.filter((angle) => angle >= FLX_MCT_DETENT_MIN_TLA).length >= TAKEOFF_THRUST_LEVERS,
      gearLeverUp: get('L:A32NX_GEAR_HANDLE_POSITION') < 0.5,
      flapsLeverIndex: get('L:A32NX_FLAPS_HANDLE_INDEX'),
      altitude: get('INDICATED ALTITUDE', SimVarValueType.Feet),
      heading: get('PLANE HEADING DEGREES MAGNETIC', SimVarValueType.Degree),
      fmgcPhase: get('L:A32NX_FMGC_FLIGHT_PHASE'),
      parkingBrakeSet: get('L:A32NX_PARK_BRAKE_LEVER_POS') === 1,
      groundSpoilersArmed: get('L:A32NX_SPOILERS_ARMED') === 1,
      groundSpoilersExtended: get('L:A32NX_SPOILERS_HANDLE_POSITION') > 0.9,
      reversersDeployed: get('L:A32NX_REVERSER_2_DEPLOYED') === 1 && get('L:A32NX_REVERSER_3_DEPLOYED') === 1,
      autobrakeDecel: get('L:A32NX_AUTOBRAKES_DECEL_LIGHT') === 1,
      engineModeSelectorStart: [1, 2, 3, 4].some((engine) => get(`A:TURB ENG IGNITION SWITCH EX1:${engine}`) === 2),
      engines: [1, 2, 3, 4].map((engine) => ({
        state: get(`L:A32NX_ENGINE_STATE:${engine}`),
        starterValveOpen: get(`L:A32NX_PNEU_ENG_${engine}_STARTER_VALVE_OPEN`) === 1,
        fuelFlow: get(`L:A32NX_ENGINE_FF:${engine}`),
      })),
      vfeNext: get('L:A32NX_SPEEDS_VFEN'),
      vapp: get('L:A32NX_SPEEDS_VAPP'),
      fcuAltitude: get('L:A32NX_FCU_AFS_DISPLAY_ALT_VALUE'),
      localizerDots: locValid ? get('L:A32NX_RADIO_RECEIVER_LOC_DEVIATION') / LOCALIZER_DOT_DEG : undefined,
      glideslopeDots: gsValid ? get('L:A32NX_RADIO_RECEIVER_GS_DEVIATION') / GLIDESLOPE_DOT_DEG : undefined,
      briefedLandingFlaps: this.read(BriefingVars.LandingFlaps),
      brakes: {
        left: get('L:A32NX_LEFT_BRAKE_PEDAL_INPUT'),
        right: get('L:A32NX_RIGHT_BRAKE_PEDAL_INPUT'),
        alternatePressure: Math.max(
          get('L:A32NX_HYD_BRAKE_ALTN_LEFT_PRESS'),
          get('L:A32NX_HYD_BRAKE_ALTN_RIGHT_PRESS'),
        ),
      },
      flightControls: {
        pitch: get('L:A32NX_SIDESTICK_POSITION_Y'),
        roll: get('L:A32NX_SIDESTICK_POSITION_X'),
        rudder: get('L:A32NX_RUDDER_PEDAL_POSITION') / 100,
      },
    };
  }
}
