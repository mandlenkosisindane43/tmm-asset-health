import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const src=readFileSync(new URL('../worker/downtime-classification.ts',import.meta.url),'utf8');
const moduleURL='data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(src)).toString('base64');
const {classifyConfirmedStops,sastBooking}=await import(moduleURL);
const iso=t=>Date.parse(t);
const make=(a,b,kind='breakdown')=>({start:iso(a),end:iso(b),kind});
const window={start:iso('2026-11-16T06:00:00Z'),end:iso('2026-11-16T16:00:00Z')};
const approved=sastBooking('2026-11-16','08:00','10:00');

test('approved SAST booking converts to UTC without treating booking itself as downtime',()=>{
 assert.equal(approved.start,iso('2026-11-16T06:00:00Z'));
 assert.equal(approved.end,iso('2026-11-16T08:00:00Z'));
 const result=classifyConfirmedStops([],[approved],window);
 assert.equal(result.planned_hours,0);
 assert.equal(result.total_stop_hours,0);
});

test('independent stops split into planned unplanned and unresolved; overlaps counted once',()=>{
 const stops=[
  make('2026-11-16T06:00:00Z','2026-11-16T08:00:00Z'),
  make('2026-11-16T11:00:00Z','2026-11-16T12:00:00Z'),
  make('2026-11-16T11:30:00Z','2026-11-16T12:00:00Z'),
  make('2026-11-16T13:00:00Z','2026-11-16T13:30:00Z','unknown')
 ];
 const a=classifyConfirmedStops(stops,[approved],window);
 assert.equal(a.planned_hours,2);assert.equal(a.unplanned_hours,1);
 assert.equal(a.unresolved_hours,0.5);assert.equal(a.total_stop_hours,3.5);
 assert.equal(a.confirmed_stop_events,4);
});

test('stop partly outside maintenance window is split correctly',()=>{
 const a=classifyConfirmedStops([make('2026-11-16T07:00:00Z','2026-11-16T09:00:00Z')],[approved],window);
 assert.equal(a.planned_hours,1);assert.equal(a.unplanned_hours,1);assert.equal(a.total_stop_hours,2);
});

test('stop and booking clipping respect requested window',()=>{
 const narrow={start:iso('2026-11-16T07:00:00Z'),end:iso('2026-11-16T07:30:00Z')};
 const a=classifyConfirmedStops([make('2026-11-16T06:00:00Z','2026-11-16T09:00:00Z')],[approved],narrow);
 assert.equal(a.planned_hours,.5);assert.equal(a.total_stop_hours,.5);
});

test('unknown stops are not automatically classified as breakdowns',()=>{
 const a=classifyConfirmedStops([make('2026-11-16T11:00:00Z','2026-11-16T12:00:00Z','unknown')],[],window);
 assert.equal(a.unplanned_hours,0);assert.equal(a.unresolved_hours,1);
});
