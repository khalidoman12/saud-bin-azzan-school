#!/usr/bin/env python3
"""Publish a truthful sync status without changing archived news on failure."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("outcome", choices=["success", "failure"])
parser.add_argument("--output", type=Path, default=Path("data/activity-sync-status.json"))
args = parser.parse_args()
previous = json.loads(args.output.read_text()) if args.output.exists() else {}
# Avoid rebuilding the site each hour when the status has not changed.
if previous.get("state") != args.outcome:
    args.output.write_text(json.dumps({
        "state": args.outcome,
        "statusSince": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }, indent=2) + "\n")
print("Public X synchronization:", args.outcome)
