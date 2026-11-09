import plistlib
from pathlib import Path

root = Path(__file__).resolve().parents[2]
plist_path = root / 'scripts/launchd/com.oportuna.sync-worker.plist'
plist = plistlib.loads(plist_path.read_bytes())

assert plist['Label'] == 'com.oportuna.sync-worker'
args = plist['ProgramArguments']
assert len(args) == 2 and all(Path(arg).is_absolute() for arg in args)
assert Path(args[0]).exists() and Path(args[1]).exists()
assert Path(plist['WorkingDirectory']) == root
assert plist['RunAtLoad'] is True and plist['KeepAlive'] is True
assert plist['ThrottleInterval'] == 30
assert 'StartCalendarInterval' not in plist, 'Oportuna must remain the only scheduler.'
assert plist['StandardOutPath'] == '/dev/null' and plist['StandardErrorPath'] == '/dev/null'

environment = plist['EnvironmentVariables']
assert environment['PROCESS_ROLE'] == 'sync-worker'
assert environment['SYNC_SCHEDULER_ENABLED'] == 'true'
assert environment['ENRICHMENT_WORKER_ENABLED'] == 'false'
assert environment['ALERT_SCHEDULER_ENABLED'] == 'false'
assert not any('SMTP' in key or 'PASSWORD' in key or 'TICKET' in key for key in environment)

supervisor = (root / 'scripts/launchd/supervise-sync-worker.mjs').read_text()
manager = (root / 'scripts/launchd/oportuna-sync-worker').read_text()
assert '5*1024*1024' in supervisor and 'retainedArchives=4' in supervisor
assert 'PROCESS_ROLE:\'sync-worker\'' in supervisor and 'SYNC_SCHEDULER_ENABLED:\'true\'' in supervisor
assert 'ENRICHMENT_WORKER_ENABLED:\'false\'' in supervisor and 'ALERT_SCHEDULER_ENABLED:\'false\'' in supervisor
assert 'require_idle' in manager and 'launchctl bootstrap' in manager and 'launchctl bootout' in manager
assert 'worker_pid_list' in manager and 'replace)' in manager
assert 'SMTP_PASSWORD' not in supervisor and 'MERCADOPUBLICO_TICKET' not in supervisor

print('PASS launchd config: plist paths, one scheduler, worker role, disabled side workers, crash restart, rotation and guarded lifecycle commands.')
