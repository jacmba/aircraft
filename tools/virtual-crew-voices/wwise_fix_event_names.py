#!/usr/bin/env python3
# Copyright (c) 2026 FlyByWire Simulations
# SPDX-License-Identifier: GPL-3.0
"""
Renames the events created by the first version of wwise_import.py, which were named
_Event_Play_FBW_A380X_VCREW_<sound> instead of Play_FBW_A380X_VCREW_<sound>.

Requirements: Wwise with the project open and WAAPI enabled, python -m pip install waapi-client
Usage: python wwise_fix_event_names.py
"""

from waapi import CannotConnectToWaapiException, WaapiClient

BANK = 'FBW_A380X_VCREW'
WRONG_PREFIX = f'_Event_Play_{BANK}_'


def main() -> None:
    try:
        client = WaapiClient()
    except CannotConnectToWaapiException:
        raise SystemExit('Cannot connect to Wwise: open the project and enable WAAPI in the user preferences')

    with client:
        result = client.call('ak.wwise.core.object.get', {'waql': '$ from type Event'}, options={'return': ['id', 'name']})
        events = [e for e in (result or {}).get('return', []) if e['name'].startswith(WRONG_PREFIX)]

        for event in events:
            name = event['name'][len('_Event_'):]
            client.call('ak.wwise.core.object.setName', {'object': event['id'], 'value': name})

        client.call('ak.wwise.core.project.save')
        print(f'Renamed {len(events)} events, e.g. {events[0]["name"]} -> {events[0]["name"][len("_Event_"):]}'
              if events else 'No event to rename')


if __name__ == '__main__':
    main()
