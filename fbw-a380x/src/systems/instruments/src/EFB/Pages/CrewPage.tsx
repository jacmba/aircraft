// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import React, { FC } from 'react';
import { Link } from 'react-router-dom';

import { NXDataStore, PilotSeat } from '@flybywiresim/fbw-sdk';
import { usePersistentProperty, useSimVar } from '@flybywiresim/fbw-sdk-react';
import { SimpleInput } from '@flybywiresim/flypad';
import { useArinc429Var } from '@instruments/common/arinc429';
import {
  VIRTUAL_CREW_PREFLIGHT_ACCELERATION,
  VIRTUAL_CREW_PREFLIGHT_DURATION_S,
  VirtualCrewBriefingFields,
  VirtualCrewButtonLocalVars,
  VirtualCrewChecklists,
  VirtualCrewChecklistStep,
  VirtualCrewCommand,
  VirtualCrewCommandLocalVar,
  VirtualCrewDefaults,
  VirtualCrewFlightPhase,
  VirtualCrewFlightPhaseNames,
  VirtualCrewSettingKeys,
  VirtualCrewStatusLocalVars,
  VirtualCrewWorkflows,
} from '../../../../shared/src/VirtualCrew';

const ChecklistStepText: Partial<Record<VirtualCrewChecklistStep, string>> = {
  [VirtualCrewChecklistStep.Opening]: 'activating the checklist on the ECL',
  [VirtualCrewChecklistStep.Reading]: 'reading',
  [VirtualCrewChecklistStep.AwaitingResponse]: 'waiting for your response',
  [VirtualCrewChecklistStep.Discrepancy]: 'discrepancy, check and respond again',
  [VirtualCrewChecklistStep.Checking]: 'checking the item',
  [VirtualCrewChecklistStep.Completing]: 'completing the checklist',
};

/** State of the checklists: the checklist being read, or the one which can be requested */
const ChecklistStatus: FC<{
  available: number;
  running: number;
  item: number;
  step: VirtualCrewChecklistStep;
  onRequest: () => void;
  onRespond: () => void;
}> = ({ available, running, item, step, onRequest, onRespond }) => {
  const runningChecklist = running > 0 ? VirtualCrewChecklists[running - 1] : undefined;
  const availableChecklist = available > 0 ? VirtualCrewChecklists[available - 1] : undefined;
  const awaitingResponse =
    step === VirtualCrewChecklistStep.AwaitingResponse || step === VirtualCrewChecklistStep.Discrepancy;

  if (runningChecklist) {
    return (
      <div className="mt-3 flex flex-row items-center justify-between">
        <div className="text-xl">
          <p className="text-theme-highlight">{runningChecklist.name.toUpperCase()} C/L</p>
          <p>
            {runningChecklist.items[item] ?? ''}
            <span
              className={
                step === VirtualCrewChecklistStep.Discrepancy ? ' text-utility-amber' : ' text-theme-unselected'
              }
            >
              {' - '}
              {ChecklistStepText[step] ?? ''}
            </span>
          </p>
        </div>
        {awaitingResponse && <ActionButton onClick={onRespond}>Respond</ActionButton>}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-row items-center justify-between">
      {step === VirtualCrewChecklistStep.Failed && (
        <p className="text-xl text-utility-amber">ECL not available, request the checklist again</p>
      )}
      {availableChecklist && <ActionButton onClick={onRequest}>{availableChecklist.name} checklist</ActionButton>}
    </div>
  );
};

/**
 * Formats a duration as minutes and seconds
 * @param seconds the duration in seconds
 * @returns the duration as mm:ss
 */
const formatCountdown = (seconds: number): string => {
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${minutes.toString().padStart(2, '0')}:${(clamped % 60).toString().padStart(2, '0')}`;
};

const Card: FC<{ title: string; className?: string }> = ({ title, className, children }) => (
  <div className={`rounded-lg border-2 border-theme-accent p-5 ${className ?? ''}`}>
    <h2 className="mb-3 text-3xl font-bold">{title}</h2>
    {children}
  </div>
);

const ActionButton: FC<{ onClick: () => void; disabled?: boolean; className?: string }> = ({
  onClick,
  disabled,
  className,
  children,
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    // the background is always explicit: Coherent paints buttons light grey by default
    className={`rounded-md border-2 px-5 py-3 text-2xl transition duration-100 ${
      disabled
        ? 'cursor-not-allowed border-theme-accent bg-theme-accent text-theme-unselected'
        : 'border-theme-highlight bg-theme-highlight text-theme-body hover:bg-theme-body hover:text-theme-highlight'
    } ${className ?? ''}`}
  >
    {children}
  </button>
);

/** Takeoff configuration of the FMS: FM1 discrete word 2, bits 13 to 16 for CONF 0, 1+F, 2 and 3 */
const TAKEOFF_FLAPS_BITS: [number, string][] = [
  [13, '0'],
  [14, '1+F'],
  [15, '2'],
  [16, '3'],
];

/**
 * Takeoff data of the FMGS used as default values of the briefing
 * @returns the takeoff thrust and flaps, empty if not available
 */
const useFmsTakeoffDefaults = (): Record<'takeoffThrust' | 'takeoffFlaps', string> => {
  const [flex] = useSimVar('L:A32NX_AIRLINER_TO_FLEX_TEMP', 'number', 1000);
  const [v1] = useSimVar('L:AIRLINER_V1_SPEED', 'knots', 1000);
  const fmDiscreteWord2 = useArinc429Var('L:A32NX_FM1_DISCRETE_WORD_2', 1000);

  // the FMS stores 0.1 for a FLEX temperature of 0, 0 means no FLEX temperature
  let takeoffThrust = '';
  if (flex > 0) {
    takeoffThrust = `FLEX ${Math.round(flex)}`;
  } else if (v1 > 0) {
    takeoffThrust = 'TOGA';
  }

  const flaps = fmDiscreteWord2.isNormalOperation()
    ? TAKEOFF_FLAPS_BITS.find(([bit]) => fmDiscreteWord2.bitValueOr(bit, false))
    : undefined;

  return { takeoffThrust, takeoffFlaps: flaps ? flaps[1] : '' };
};

/**
 * A briefing value stored per flight in the persistent storage. A value of the FMGS is used as long as the pilot does
 * not enter another one, clearing the entry returns to the value of the FMGS.
 */
const BriefingField: FC<{
  storageKey: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  fmsValue?: string;
}> = ({ storageKey, label, placeholder, disabled, fmsValue }) => {
  const [value, setValue] = usePersistentProperty(storageKey, '');
  const fromFms = value === '' && !!fmsValue;

  return (
    <div className="flex flex-row items-center justify-between py-1">
      <span className="text-xl">
        {label}
        {fromFms && <span className="ml-3 text-lg text-theme-highlight">FMS</span>}
      </span>
      <SimpleInput
        className="w-96"
        value={fromFms ? fmsValue : value}
        placeholder={placeholder}
        uppercase
        disabled={disabled}
        onChange={(newValue) => setValue(newValue === fmsValue ? '' : newValue)}
      />
    </div>
  );
};

/** Takeoff data inserted in the FMS, shown in the briefing but not entered again */
const FmsTakeoffData: FC = () => {
  const [v1] = useSimVar('L:AIRLINER_V1_SPEED', 'knots', 1000);
  const [vr] = useSimVar('L:AIRLINER_VR_SPEED', 'knots', 1000);
  const [v2] = useSimVar('L:AIRLINER_V2_SPEED', 'knots', 1000);

  const speed = (value: number) => (value > 0 ? Math.round(value).toString() : '---');

  const items: [string, string][] = [
    ['V1', speed(v1)],
    ['VR', speed(vr)],
    ['V2', speed(v2)],
  ];

  return (
    <div className="mb-2 flex flex-row justify-between rounded-md bg-theme-accent px-6 py-2">
      {items.map(([label, value]) => (
        <span key={label} className="text-2xl">
          <span className="text-theme-unselected">{label} </span>
          <span className="font-bold text-theme-highlight">{value}</span>
        </span>
      ))}
      <span className="text-xl text-theme-unselected">from FMS</span>
    </div>
  );
};

/** Workflows of the preflight with their state, the tasks of the seat of the user are left to the user */
const PreflightSchedule: FC<{ elapsedS: number; runningWorkflowId: string | undefined; userSeat: 'CAPT' | 'FO' }> = ({
  elapsedS,
  runningWorkflowId,
  userSeat,
}) => (
  <div className="mt-2 w-full divide-y divide-theme-accent text-lg">
    {VirtualCrewWorkflows.map((workflow) => {
      const own = workflow.seat === userSeat;
      const started = elapsedS >= workflow.preflightMinute * 60;
      const running = workflow.id === runningWorkflowId;
      let state: string;
      let stateClass: string;
      if (running) {
        state = 'IN PROGRESS';
        stateClass = 'text-theme-highlight';
      } else if (started) {
        state = own ? 'YOUR TASK' : 'DONE';
        stateClass = own ? 'text-utility-amber' : 'text-utility-green';
      } else {
        state = own ? 'YOUR TASK' : 'PLANNED';
        stateClass = own ? 'text-utility-amber' : 'text-theme-unselected';
      }

      return (
        <div key={workflow.id} className="flex flex-row items-center justify-between whitespace-nowrap py-1">
          <span className="w-16 shrink-0 font-mono text-theme-unselected">
            {formatCountdown(workflow.preflightMinute * 60)}
          </span>
          <span className="w-16 shrink-0">{workflow.seat}</span>
          <span className="flex-1 truncate">{workflow.name}</span>
          <span className={`w-32 shrink-0 text-right ${stateClass}`}>{state}</span>
        </div>
      );
    })}
  </div>
);

/**
 * Page of the flyPad to interact with the virtual crew: flight phase, preflight countdown and takeoff briefing.
 */
export const CrewPage: FC = () => {
  const [enabled] = usePersistentProperty(VirtualCrewSettingKeys.Enabled, VirtualCrewDefaults.enabled);
  const [phase] = useSimVar(VirtualCrewStatusLocalVars.Phase, 'number', 250);
  const [remaining] = useSimVar(VirtualCrewStatusLocalVars.PreflightRemaining, 'number', 100);
  const [accelerated] = useSimVar(VirtualCrewStatusLocalVars.Accelerated, 'number', 250);
  const [workflow] = useSimVar(VirtualCrewStatusLocalVars.Workflow, 'number', 250);
  const [briefingDone] = useSimVar(VirtualCrewStatusLocalVars.BriefingDone, 'number', 250);
  const [checklistAvailable] = useSimVar(VirtualCrewStatusLocalVars.ChecklistAvailable, 'number', 250);
  const [checklistRunning] = useSimVar(VirtualCrewStatusLocalVars.ChecklistRunning, 'number', 250);
  const [checklistItem] = useSimVar(VirtualCrewStatusLocalVars.ChecklistItem, 'number', 250);
  const [checklistStep] = useSimVar(VirtualCrewStatusLocalVars.ChecklistStep, 'number', 250);
  const [, pressPrimary] = useSimVar(VirtualCrewButtonLocalVars.Primary, 'number');
  const [pilotSeat] = useSimVar('L:FBW_PILOT_SEAT', 'enum', 1000);
  const fmsDefaults = useFmsTakeoffDefaults();
  const [, sendCommand] = useSimVar(VirtualCrewCommandLocalVar, 'number');

  if (enabled !== '1') {
    return (
      <div>
        <h1 className="mb-4 font-bold">Crew</h1>
        <Card title="Virtual crew disabled">
          <p className="text-2xl">
            Enable the virtual crew in{' '}
            <Link to="/settings/virtual-crew" className="text-theme-highlight underline">
              Settings - Virtual Crew
            </Link>
            .
          </p>
        </Card>
      </div>
    );
  }

  const currentPhase = phase as VirtualCrewFlightPhase;
  const runningWorkflow = workflow > 0 ? VirtualCrewWorkflows[workflow - 1] : undefined;
  const busy = runningWorkflow !== undefined;
  const isAccelerated = accelerated === 1;
  const userSeat = pilotSeat === PilotSeat.Right ? 'FO' : 'CAPT';
  const isBriefingDone = briefingDone === 1;
  // the briefing belongs to the preflight, or is the first step when the preflight is skipped
  const briefingPossible =
    currentPhase === VirtualCrewFlightPhase.Preflight ||
    currentPhase === VirtualCrewFlightPhase.TakeoffBriefing ||
    currentPhase === VirtualCrewFlightPhase.BeforeStart;
  const briefingEditable = currentPhase <= VirtualCrewFlightPhase.BeforeStart;

  const clearBriefing = () => VirtualCrewBriefingFields.forEach((field) => NXDataStore.setLegacy(field.key, ''));

  return (
    <div>
      <div className="mb-4 flex flex-row items-center justify-between">
        <h1 className="font-bold">Crew</h1>
        {currentPhase !== VirtualCrewFlightPhase.Idle && (
          <ActionButton
            className="!py-1"
            onClick={() => {
              sendCommand(VirtualCrewCommand.Reset);
              clearBriefing();
            }}
          >
            End flight
          </ActionButton>
        )}
      </div>

      <div className="flex flex-row space-x-6">
        <div className="flex w-2/5 flex-col space-y-6">
          <Card title="Flight phase">
            <p className="text-3xl text-theme-highlight">{VirtualCrewFlightPhaseNames[currentPhase] ?? 'Unknown'}</p>
            <p className="mt-2 text-2xl">
              {runningWorkflow ? `${runningWorkflow.seat}: ${runningWorkflow.name}` : 'No crew member busy'}
            </p>
            <ChecklistStatus
              available={checklistAvailable}
              running={checklistRunning}
              item={checklistItem}
              step={checklistStep}
              onRequest={() => sendCommand(VirtualCrewCommand.RequestChecklist)}
              onRespond={() => pressPrimary(1)}
            />
          </Card>

          <Card title="Preflight">
            {currentPhase === VirtualCrewFlightPhase.Idle && (
              <div className="flex flex-col space-y-4">
                <ActionButton onClick={() => sendCommand(VirtualCrewCommand.StartPreflight)}>
                  Start preflight (40 min)
                </ActionButton>
                <ActionButton onClick={() => sendCommand(VirtualCrewCommand.StartTakeoffBriefing)}>
                  Skip to takeoff briefing
                </ActionButton>
              </div>
            )}

            {currentPhase === VirtualCrewFlightPhase.Preflight && (
              <div className="flex flex-col items-center space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sendCommand(VirtualCrewCommand.ToggleAcceleration)}
                  // dark background in every state, Coherent paints buttons light grey by default
                  className={`w-full rounded-lg border-4 bg-theme-body py-2 font-mono text-7xl ${
                    busy
                      ? 'cursor-not-allowed border-theme-accent text-theme-unselected'
                      : isAccelerated
                        ? 'border-theme-highlight text-theme-highlight'
                        : 'border-theme-accent text-theme-text hover:border-theme-highlight'
                  }`}
                >
                  {formatCountdown(remaining)}
                </button>
                <p className="text-xl text-theme-unselected">
                  {busy && 'Crew busy, the countdown cannot be accelerated'}
                  {!busy &&
                    isAccelerated &&
                    `Accelerated x${VIRTUAL_CREW_PREFLIGHT_ACCELERATION}, click for normal pace`}
                  {!busy && !isAccelerated && `Click to accelerate x${VIRTUAL_CREW_PREFLIGHT_ACCELERATION}`}
                </p>
                <PreflightSchedule
                  elapsedS={VIRTUAL_CREW_PREFLIGHT_DURATION_S - remaining}
                  runningWorkflowId={runningWorkflow?.id}
                  userSeat={userSeat}
                />
              </div>
            )}

            {currentPhase > VirtualCrewFlightPhase.Preflight && (
              <p className="text-2xl text-theme-unselected">Preflight completed or skipped</p>
            )}
          </Card>
        </div>

        <Card title="Takeoff briefing" className="w-3/5">
          <FmsTakeoffData />
          <div className="divide-y-2 divide-theme-accent">
            {VirtualCrewBriefingFields.map((field) => (
              <BriefingField
                key={field.key}
                storageKey={field.key}
                label={field.label}
                placeholder={field.placeholder}
                disabled={!briefingEditable}
                fmsValue={field.fmsDefault ? fmsDefaults[field.fmsDefault] : undefined}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-row justify-end">
            {isBriefingDone ? (
              <span className="rounded-md border-2 border-utility-green px-5 py-3 text-2xl text-utility-green">
                Takeoff briefing performed
              </span>
            ) : (
              <ActionButton
                disabled={!briefingPossible}
                onClick={() => sendCommand(VirtualCrewCommand.CompleteTakeoffBriefing)}
              >
                Perform takeoff briefing
              </ActionButton>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
