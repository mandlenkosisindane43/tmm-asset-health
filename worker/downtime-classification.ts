/** Auditable interval classification. Booking alone is never proof of a stop.
 * Times are UTC milliseconds; bookings originate in SAST (+02:00).
 * Stop intervals must be separately confirmed by an authorised source.
 */
export type Interval={start:number;end:number};
export type StopInterval=Interval&{kind:"maintenance"|"breakdown"|"unknown";id?:number|string};
export type BookingInterval=Interval&{id?:number|string};
const finite=(v:number)=>Number.isFinite(v);
const valid=(x:Interval)=>finite(x.start)&&finite(x.end)&&x.end>x.start;
const hours=(ms:number)=>Math.round(ms/36000)/100;
export const sastBooking=(day:string,start:string,end:string):Interval|null=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||end<=start)return null;
 const a=Date.parse(day+"T"+start+":00+02:00"),b=Date.parse(day+"T"+end+":00+02:00");
 return valid({start:a,end:b})?{start:a,end:b}:null;
};
export function classifyConfirmedStops(stops:StopInterval[],bookings:BookingInterval[],window:Interval){
 if(!valid(window))return {planned_hours:0,unplanned_hours:0,unresolved_hours:0,total_stop_hours:0,confirmed_stop_events:0,matched_bookings:0,coverage:"invalid-window"};
 const eligible=stops.filter(s=>valid(s)&&s.end>window.start&&s.start<window.end);
 const approved=bookings.filter(b=>valid(b)&&b.end>window.start&&b.start<window.end);
 const points=new Set<number>([window.start,window.end]);
 for(const s of eligible){points.add(Math.max(s.start,window.start));points.add(Math.min(s.end,window.end))}
 for(const b of approved){points.add(Math.max(b.start,window.start));points.add(Math.min(b.end,window.end))}
 const cuts=[...points].sort((a,b)=>a-b);let planned=0,unplanned=0,unresolved=0;
 const matched=new Set<string>();
 for(let i=1;i<cuts.length;i++){
  const a=cuts[i-1],b=cuts[i];if(b<=a)continue;
  const active=eligible.filter(s=>s.start<b&&s.end>a);if(!active.length)continue;
  const book=approved.filter(x=>x.start<b&&x.end>a);
  const maintenance=active.some(s=>s.kind==="maintenance"),breakdown=active.some(s=>s.kind==="breakdown");
  if(maintenance&&breakdown)unresolved+=b-a; // conflicting causes require human reconciliation
  else if(breakdown)unplanned+=b-a; // breakdown remains unplanned even within a booked window
  else if(maintenance&&book.length){planned+=b-a;for(const x of book)matched.add(String(x.id??x.start));}
  else unresolved+=b-a; // unknown stops and unbooked maintenance are not automatically planned
 }
 return {planned_hours:hours(planned),unplanned_hours:hours(unplanned),unresolved_hours:hours(unresolved),total_stop_hours:hours(planned+unplanned+unresolved),confirmed_stop_events:eligible.length,matched_bookings:matched.size,coverage:"confirmed-stop-intervals-only"};
}
