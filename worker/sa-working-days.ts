/** South African calendar dates for non-shift working-day reports. UTC arithmetic avoids server time-zone drift. */
export const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
export function sastDate(instant: string | number | Date = Date.now()): string {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  return new Date(ms + SAST_OFFSET_MS).toISOString().slice(0, 10);
}
function addDays(day: string, delta: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + delta * 86400000).toISOString().slice(0, 10);
}
function easterSunday(year: number): string {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,
    f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,
    i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,
    m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),
    day=((h+l-7*m+114)%31)+1;
  return year+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
}
export function southAfricanPublicHolidays(year: number): Set<string> {
  const fixed=["01-01","03-21","04-27","05-01","06-16","08-09","09-24","12-16","12-25","12-26"];
  const easter=easterSunday(year);
  const holidays=new Set([...fixed.map(d=>year+"-"+d),addDays(easter,-2),addDays(easter,1)]);
  // If a listed public holiday is Sunday, the next Monday is also a holiday.
  for(const day of [...holidays]) if(new Date(day+"T00:00:00Z").getUTCDay()===0) holidays.add(addDays(day,1));
  return holidays;
}
export function isSouthAfricanWorkingDay(day: string): boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day+"T00:00:00Z"))) return false;
  const weekday=new Date(day+"T00:00:00Z").getUTCDay();
  return weekday>=1 && weekday<=5 && !southAfricanPublicHolidays(Number(day.slice(0,4))).has(day);
}
export function nearestWorkingDay(day: string, direction: -1 | 1 = -1): string {
  let result=day;
  for(let i=0;i<40;i++){ if(isSouthAfricanWorkingDay(result)) return result; result=addDays(result,direction); }
  throw new Error("No working day found");
}
export function shiftWorkingDay(day: string, direction: -1 | 1): string {
  return nearestWorkingDay(addDays(day,direction),direction);
}
export function sastDayStartUtc(day:string):string {return new Date(Date.parse(day+"T00:00:00Z")-SAST_OFFSET_MS).toISOString();}
