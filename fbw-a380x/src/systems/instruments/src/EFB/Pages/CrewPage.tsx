// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import React, { FC } from 'react';
import { Link } from 'react-router-dom';

import { NXDataStore } from '@flybywiresim/fbw-sdk';
import { usePersistentProperty, useSimVar } from '@flybywiresim/fbw-sdk-react';
import { SimpleInput } from '@flybywiresim/flypad';
import {
  VIRTUAL_CREW_PREFLIGHT_ACCELERATION,
  VirtualCrewBriefingFields,
  VirtualCrewCommand,
  VirtualCrewCommandLocalVar,
  VirtualCrewDefaults,
  VirtualCrewFlightPhase,
  VirtualCrewFlightPhaseNames,
  VirtualCrewSettingKeys,
  VirtualCrewStatusLocalVars,
  VirtualCrewWorkflows,
} from '../../../../shared/src/VirtualCrew';

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
  <div className={`rounded-lg border-2 border-theme-accent p-6 ${className ?? ''}`}>
    <h2 className="mb-4 text-3xl font-bold">{title}</h2>
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
    className={`rounded-md border-2 px-5 py-3 text-2xl transition duration-100 ${
      disabled
        ? 'cursor-not-allowed border-theme-accent text-theme-unselected'
        : 'border-theme-highlight bg-theme-highlight text-theme-body hover:bg-theme-body hover:text-theme-highlight'
    } ${className ?? ''}`}
  >
    {children}
  </button>
);

/** A briefing value stored per flight in the persistent storage */
const BriefingField: FC<{ storageKey: string; label: string; placeholder: string; disabled: boolean }> = ({
  storageKey,
  label,
  placeholder,
  disabled,
}) => {
  const [value, setValue] = usePersistentProperty(storageKey, '');

  return (
    <div className="flex flex-row items-center justify-between py-2">
      <span className="text-2xl">{label}</span>
      <SimpleInput
        className="w-96"
        value={value}
        placeholder={placeholder}
        uppercase
        disabled={disabled}
        onChange={(newValue) => setValue(newValue)}
      />
    </div>
  );
};

/** Takeoff data inserted in the FMS, shown in the briefing but not entered again */
const FmsTakeoffData: FC = () => {
  const [v1] = useSimVar('L:AIRLINER_V1_SPEED', 'knots', 1000);
  const [vr] = useSimVar('L:AIRLINER_VR_SPEED', 'knots', 1000);
  const [v2] = useSimVar('L:AIRLINER_V2_SPEED', 'knots', 1000);
  const [flex] = useSimVar('L:A32NX_AIRLINER_TO_FLEX_TEMP', 'number', 1000);

  const speed = (value: number) => (value > 0 ? Math.round(value).toString() : '---');

  const items: [string, string][] = [
    ['V1', speed(v1)],
    ['VR', speed(vr)],
    ['V2', speed(v2)],
    // 0.1 is used by the FMS for a FLEX temperature of 0
    ['FLEX', flex > 0 ? `${Math.round(flex)}°C` : 'TOGA'],
  ];

  return (
    <div className="mb-4 flex flex-row justify-between rounded-md bg-theme-accent px-6 py-3">
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

/**
 * Page of the flyPad to interact with the virtual crew: flight phase, preflight countdown and takeoff briefing.
 */
export const CrewPage: FC = () => {
  const [enabled] = usePersistentProperty(VirtualCrewSettingKeys.Enabled, VirtualCrewDefaults.enabled);
  const [phase] = useSimVar(VirtualCrewStatusLocalVars.Phase, 'number', 250);
  const [remaining] = useSimVar(VirtualCrewStatusLocalVars.PreflightRemaining, 'number', 100);
  const [accelerated] = useSimVar(VirtualCrewStatusLocalVars.Accelerated, 'number', 250);
  const [workflow] = useSimVar(VirtualCrewStatusLocalVars.Workflow, 'number', 250);
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
  const briefingEditable = currentPhase <= VirtualCrewFlightPhase.TakeoffBriefing;

  const clearBriefing = () => VirtualCrewBriefingFields.forEach((field) => NXDataStore.setLegacy(field.key, ''));

  return (
    <div>
      <h1 className="mb-4 font-bold">Crew</h1>

      <div className="flex flex-row space-x-6">
        <div className="flex w-2/5 flex-col space-y-6">
          <Card title="Flight phase">
            <p className="text-3xl text-theme-highlight">{VirtualCrewFlightPhaseNames[currentPhase] ?? 'Unknown'}</p>
            <p className="mt-3 text-2xl">
              {runningWorkflow ? `${runningWorkflow.seat}: ${runningWorkflow.name}` : 'No crew member busy'}
            </p>
            {currentPhase !== VirtualCrewFlightPhase.Idle && (
              <ActionButton
                className="mt-6"
                onClick={() => {
                  sendCommand(VirtualCrewCommand.Reset);
                  clearBriefing();
                }}
              >
                End flight
              </ActionButton>
            )}
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
              <div className="flex flex-col items-center space-y-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sendCommand(VirtualCrewCommand.ToggleAcceleration)}
                  className={`w-full rounded-lg border-4 py-6 font-mono text-8xl ${
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
                <ActionButton disabled={busy} onClick={() => sendCommand(VirtualCrewCommand.StartTakeoffBriefing)}>
                  Start takeoff briefing now
                </ActionButton>
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
              />
            ))}
          </div>
          <div className="mt-6 flex flex-row justify-end">
            <ActionButton
              disabled={currentPhase !== VirtualCrewFlightPhase.TakeoffBriefing}
              onClick={() => sendCommand(VirtualCrewCommand.CompleteTakeoffBriefing)}
            >
              Takeoff briefing performed
            </ActionButton>
          </div>
        </Card>
      </div>
    </div>
  );
};
