# -*- coding: utf-8 -*-
"""Create a consistent SQLite backup on the private server; store encrypted offsite."""
from pathlib import Path
from datetime import datetime, timezone
import os
import sqlite3
import sys
import stat
if len(sys.argv)!=2:
    raise SystemExit("Usage: python tools/backup.py /secure-backups")
source=Path(os.environ.get("TALENT_DB_PATH","private/talent.sqlite3"))
destination=Path(sys.argv[1]).expanduser().resolve()
if not source.exists():
    raise SystemExit("Source database does not exist")
destination.mkdir(parents=True,exist_ok=True)
path=destination / ("talent-"+datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")+"-UTC.sqlite3")
with sqlite3.connect(source) as original, sqlite3.connect(path) as backup:
    original.backup(backup)
os.chmod(path,stat.S_IRUSR|stat.S_IWUSR)
print("Backup created:",path)
print("IMPORTANT: encrypt before transferring offsite; confirm recovery tests.")
