// Copyright (c) 2022-2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { AircraftGithubVersionChecker } from '@flybywiresim/fbw-sdk';
import { EventBus, SimVarValueType } from '@microsoft/msfs-sdk';

/**
 * Version check of the aircraft. The check against GitHub is disabled for the A380X: local development builds would
 * always be reported as outdated.
 */
export class VersionCheck {
  constructor(
    private readonly aircraftProjectPrefix: string,
    private readonly bus: EventBus,
  ) {
    console.log('VersionCheck: Created');
  }

  public connectedCallback(): void {
    AircraftGithubVersionChecker.setEditionLocalVar(this.aircraftProjectPrefix);
  }

  public startPublish(): void {
    console.log('VersionCheck: startPublish()');

    // The flag is shared by all aircraft of the simulator session (e.g. set by a previously loaded A32NX), clear it so
    // that the flyPad does not show "Outdated Aircraft Version".
    SimVar.SetSimVarValue('L:A32NX_OUTDATED_VERSION', SimVarValueType.Bool, 0);
    console.log('VersionCheck: disabled for the A380X');
  }
}
