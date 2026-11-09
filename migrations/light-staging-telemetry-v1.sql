-- STAGING ONLY. Run once against tmm-asset-health-light-staging-db.
-- Unified telemetry from authorised OEM APIs, gateways or Arduino devices.
CREATE TABLE IF NOT EXISTS tmm_telemetry_v1 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 machine_id TEXT NOT NULL,
 source TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 engine_hours REAL,
 working_hours REAL,
 idle_hours REAL,
 fuel_litres REAL,
 hydraulic_pressure_bar REAL,
 hydraulic_oil_temp_c REAL,
 coolant_temp_c REAL,
 payload_tonnes REAL,
 latitude REAL,
 longitude REAL,
 fault_code TEXT,
 fault_description TEXT,
 severity TEXT,
 raw_json TEXT NOT NULL,
 FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE INDEX IF NOT EXISTS idx_tmm_telemetry_company_machine_time ON tmm_telemetry_v1(company_id,machine_id,recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tmm_telemetry_dedupe ON tmm_telemetry_v1(company_id,machine_id,source,recorded_at,COALESCE(fault_code,''));
