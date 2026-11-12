"""One-time, recoverable reset of the explicitly authorised staging demo only.

Run through the light-staging Actions environment. No production endpoint or
credential input is accepted. Backups stay inside the same private staging DB.
"""
import json
import os
import re
import time
import urllib.request
from pathlib import Path

ACCOUNT = 'ba53c9a85c6f300723d5d58f899722f9'
DATABASE = 'b7f64035-831b-45ab-8a6c-036a67368bd7'
COMPANY = 'TMM Staging Demo'
RESET = 'clear-staging-demo-20261112'
PREFIX = 'reset_20261112_'
# Configuration, accounts, source credentials and the diagnostic library are excluded.
OPERATIONAL = set('''machines events work_orders production_records daily_reports_v3
report_history_v3 contractor_documents approvals_v3 purchase_orders
machine_telemetry_v1 telemetry_alerts_v1 telemetry_actions_v1
telemetry_analysis_failures_v3 telemetry_analysis_receipts_v3
telemetry_auto_alerts_v3 telemetry_automation_targets_v3 telemetry_automation_runs_v3
telemetry_condition_findings_v2 telemetry_delivery_outbox_v3
telemetry_discovered_assets_v1 telemetry_ingest_v2 telemetry_machine_map_v2
telemetry_quarantine_v2 telemetry_report_documents_v2 telemetry_report_snapshots_v2
engineering_recommendations_v1 mechanic_job_audit_v1 mechanic_job_evidence_v1
month_end_v1 operational_alert_audit_v1 operational_sms_audit_v1
reliability_audit_v1 reliability_notifications_v1 reliability_work_orders_v1
role_checklists_v4 role_inspections_v4 role_parts_requests_v4 role_permits_v4
role_shift_notes_v4 role_work_notes_v4 demo_alert_deliveries_v1 demo_alerts_v1
demo_import_batches_v1 demo_import_records_v1 demo_sms_deliveries_v1
demo_zip_packages_v1 demo_zip_sections_v1 recycle_bin_v1'''.split())


def ident(name):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
        raise ValueError('Unsafe SQL identifier')
    return '"' + name + '"'


def statement(sql, params=()):
    return {'sql': sql, 'params': list(params)}


def plan(schema, cid):
    """Archive every affected table before deleting; child tables precede parents."""
    tables = sorted(OPERATIONAL & schema.keys())
    for name in tables:
        if 'company_id' not in schema[name]['columns']:
            raise ValueError('Missing tenant key: ' + name)
    ordered = []
    visiting = set()
    def visit(name):
        if name in ordered:
            return
        if name in visiting:
            raise ValueError('Cyclic foreign keys; reset needs explicit review')
        visiting.add(name)
        for child in tables:
            if name in schema[child]['parents']:
                visit(child)
        visiting.remove(name)
        ordered.append(name)
    for name in tables:
        visit(name)
    backup = [statement(f'CREATE TABLE {ident(PREFIX+n)} AS SELECT * FROM {ident(n)} WHERE company_id=?', [cid]) for n in tables]
    delete = [statement(f'DELETE FROM {ident(n)} WHERE company_id=?', [cid]) for n in ordered]
    return tables, backup, delete


def main():
    cfg = json.loads(Path('wrangler.light-staging.jsonc').read_text())
    db = cfg['d1_databases']
    if (cfg['name'] != 'tmm-asset-health-light-staging' or cfg['account_id'] != ACCOUNT
        or len(db) != 1 or db[0]['database_id'] != DATABASE
        or db[0]['database_name'] != 'tmm-asset-health-light-staging-db'
        or os.environ.get('CLOUDFLARE_ACCOUNT_ID') != ACCOUNT
        or os.environ.get('TMM_RESET_REQUEST') != RESET):
        raise SystemExit('Staging reset guard rejected configuration')
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token:
        raise SystemExit('Missing existing light-staging Cloudflare credential')
    endpoint = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DATABASE}/query'
    def query(statements):
        # Never print headers, credentials, row contents or HTTP error bodies.
        req = urllib.request.Request(endpoint, json.dumps({'batch': statements}).encode(),
            {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as response:
            body = json.load(response)
        if not body.get('success') or any(not r.get('success', True) for r in body.get('result', [])):
            raise RuntimeError('D1 query failed; reset halted')
        return body['result']
    def rows(sql, params=()):
        return query([statement(sql, params)])[0]['results']
    companies = rows('SELECT id FROM companies WHERE name=?', [COMPANY])
    if len(companies) != 1:
        raise SystemExit('Expected exactly one TMM Staging Demo company')
    cid = companies[0]['id']
    names = [r['name'] for r in rows("SELECT name FROM sqlite_master WHERE type='table'")]
    if 'staging_reset_receipts_v1' in names:
        done = rows('SELECT summary_json FROM staging_reset_receipts_v1 WHERE request_id=?', [RESET])
        if done:
            print('Already completed; no data changed. Original receipt: ' + done[0]['summary_json'])
            return
    if any(n.startswith(PREFIX) for n in names):
        raise SystemExit('Prior backup exists without receipt; manual recovery review required')
    schema = {}
    for name in names:
        if name in OPERATIONAL or name == 'telemetry_simulator_v2':
            schema[name] = {'columns': [r['name'] for r in rows(f'PRAGMA table_info({ident(name)})')],
                            'parents': [r['table'] for r in rows(f'PRAGMA foreign_key_list({ident(name)})')]}
    tables, backup, delete = plan(schema, cid)
    if not {'machines', 'machine_telemetry_v1'} <= set(tables):
        raise SystemExit('Expected staging operational schema missing')
    def counts(other=False):
        op = '!=' if other else '='
        result = query([statement(f'SELECT count(*) n FROM {ident(n)} WHERE company_id{op}?', [cid]) for n in tables])
        return {n: r['results'][0]['n'] for n, r in zip(tables, result)}
    before, others = counts(), counts(True)
    accounts = rows('SELECT count(*) n FROM contractor_accounts WHERE company_id=?', [cid])[0]['n']
    # Include simulator state in the recoverable backup; retain an explicit disabled row.
    if 'telemetry_simulator_v2' in schema:
        backup.append(statement(f'CREATE TABLE {ident(PREFIX+"telemetry_simulator_v2")} AS SELECT * FROM telemetry_simulator_v2 WHERE company_id=?', [cid]))
    query(backup)
    for name in tables:
        archived = rows(f'SELECT count(*) n FROM {ident(PREFIX+name)}')[0]['n']
        if archived != before[name]:
            raise RuntimeError('Data changed during backup; reset halted before deletion')
    if 'telemetry_simulator_v2' in schema:
        query([statement("UPDATE telemetry_simulator_v2 SET enabled=0,last_status='Disabled for fresh real-data test' WHERE company_id=?", [cid])])
    # Batch transaction: remove tenant-specific children before parent fleet records.
    query(delete)
    # Allow a scheduler invocation already in progress to finish before verifying.
    time.sleep(35)
    after = counts()
    if any(after.values()) or counts(True) != others:
        raise RuntimeError('Reset verification failed; private backups retained')
    if rows('SELECT count(*) n FROM contractor_accounts WHERE company_id=?', [cid])[0]['n'] != accounts:
        raise RuntimeError('Account preservation verification failed')
    summary = {'request_id': RESET, 'company': COMPANY, 'company_id': cid,
        'before': before, 'after': after, 'accounts_preserved': accounts,
        'other_company_counts_unchanged': True, 'private_backup_prefix': PREFIX,
        'simulator_enabled': 0, 'availability': None, 'utilisation': None}
    query([statement('CREATE TABLE IF NOT EXISTS staging_reset_receipts_v1(request_id TEXT PRIMARY KEY,company_id INTEGER NOT NULL,summary_json TEXT NOT NULL,completed_at TEXT NOT NULL)'),
        statement("INSERT INTO staging_reset_receipts_v1 VALUES(?,?,?,datetime('now'))", [RESET, cid, json.dumps(summary)])])
    Path('staging-reset-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
