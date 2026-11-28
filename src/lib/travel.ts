// Overland travel time from the Player's Handbook, chapter 9: Table 9–3 (Movement and Distance),
// Table 9–5 (Terrain and Overland Movement), Table 9–6 (Mounts and Vehicles) and the Overland
// Movement text. The distance is the user's (from a map or a source); nothing here is invented.

export type Route = 'highway' | 'road' | 'trackless';

// Table 9–5: multipliers for highway / road or trail / trackless
export const TERRAIN: { name: string; m: Record<Route, number> }[] = [
  { name: 'Desert, sandy', m: { highway: 1, road: 1 / 2, trackless: 1 / 2 } },
  { name: 'Forest', m: { highway: 1, road: 1, trackless: 1 / 2 } },
  { name: 'Hills', m: { highway: 1, road: 3 / 4, trackless: 1 / 2 } },
  { name: 'Jungle', m: { highway: 1, road: 3 / 4, trackless: 1 / 4 } },
  { name: 'Moor', m: { highway: 1, road: 1, trackless: 3 / 4 } },
  { name: 'Mountains', m: { highway: 3 / 4, road: 3 / 4, trackless: 1 / 2 } },
  { name: 'Plains', m: { highway: 1, road: 1, trackless: 3 / 4 } },
  { name: 'Swamp', m: { highway: 1, road: 3 / 4, trackless: 1 / 2 } },
  { name: 'Tundra, frozen', m: { highway: 1, road: 3 / 4, trackless: 3 / 4 } },
];

export interface Mode {
  id: string;
  name: string;
  group: 'On foot' | 'Mounted' | 'Vehicle' | 'On water';
  mph: number; // miles per hour
  hours: number; // hours of travel in a day (Overland Movement: 8; rowed 10; sailing 24)
  water?: boolean; // terrain doesn't apply
  downstream?: boolean; // raft/barge/keelboat/rowboat: a current can be added
}

// Table 9–3 (one hour / one day, walking) and Table 9–6
export const MODES: Mode[] = [
  { id: 'foot15', name: 'Walking, speed 15 ft.', group: 'On foot', mph: 1.5, hours: 8 },
  { id: 'foot20', name: 'Walking, speed 20 ft.', group: 'On foot', mph: 2, hours: 8 },
  { id: 'foot30', name: 'Walking, speed 30 ft.', group: 'On foot', mph: 3, hours: 8 },
  { id: 'foot40', name: 'Walking, speed 40 ft.', group: 'On foot', mph: 4, hours: 8 },
  { id: 'lhorse', name: 'Light horse or light warhorse', group: 'Mounted', mph: 6, hours: 8 },
  { id: 'lhorse-l', name: 'Light horse (151–450 lb.) / light warhorse (231–690 lb.), loaded', group: 'Mounted', mph: 4, hours: 8 },
  { id: 'hhorse', name: 'Heavy horse or heavy warhorse', group: 'Mounted', mph: 5, hours: 8 },
  { id: 'hhorse-l', name: 'Heavy horse (201–600 lb.) / heavy warhorse (301–900 lb.), loaded', group: 'Mounted', mph: 3.5, hours: 8 },
  { id: 'pony', name: 'Pony or warpony', group: 'Mounted', mph: 4, hours: 8 },
  { id: 'pony-l', name: 'Pony (76–225 lb.) / warpony (101–300 lb.), loaded', group: 'Mounted', mph: 3, hours: 8 },
  { id: 'mule', name: 'Donkey or mule', group: 'Mounted', mph: 3, hours: 8 },
  { id: 'mule-l', name: 'Donkey (51–150 lb.) / mule (231–690 lb.), loaded', group: 'Mounted', mph: 2, hours: 8 },
  { id: 'dog', name: 'Riding dog', group: 'Mounted', mph: 4, hours: 8 },
  { id: 'dog-l', name: 'Riding dog (101–300 lb.), loaded', group: 'Mounted', mph: 3, hours: 8 },
  { id: 'cart', name: 'Cart or wagon', group: 'Vehicle', mph: 2, hours: 8 },
  { id: 'raft', name: 'Raft or barge (poled or towed)', group: 'On water', mph: 0.5, hours: 10, water: true, downstream: true },
  { id: 'keelboat', name: 'Keelboat (rowed)', group: 'On water', mph: 1, hours: 10, water: true, downstream: true },
  { id: 'rowboat', name: 'Rowboat (rowed)', group: 'On water', mph: 1.5, hours: 10, water: true, downstream: true },
  { id: 'sailing', name: 'Sailing ship (sailed)', group: 'On water', mph: 2, hours: 24, water: true },
  { id: 'warship', name: 'Warship (sailed and rowed)', group: 'On water', mph: 2.5, hours: 24, water: true },
  { id: 'longship', name: 'Longship (sailed and rowed)', group: 'On water', mph: 3, hours: 24, water: true },
  { id: 'galley', name: 'Galley (rowed and sailed)', group: 'On water', mph: 4, hours: 24, water: true },
];

export interface TravelInput {
  miles: number;
  mode: Mode;
  terrain: number; // index into TERRAIN
  route: Route;
  extraHours: number; // forced march: hours beyond 8 a day (land only)
  downstream: boolean; // with a current (typically 3 mph) and 14 more hours of floating
}

export interface TravelResult {
  perDay: number; // miles a day
  days: number; // to cover the distance
  hoursLastDay: number;
  multiplier: number;
  notes: string[];
}

export function travel(t: TravelInput): TravelResult {
  const notes: string[] = [];
  const multiplier = t.mode.water ? 1 : TERRAIN[t.terrain].m[t.route];
  let perDay: number;
  let perHour = t.mode.mph * multiplier;
  if (t.mode.downstream && t.downstream) {
    // "add the speed of the current (typically 3 miles per hour)… the vehicle can also float an
    // additional 14 hours… so add an additional 42 miles to the daily distance"
    perHour += 3;
    perDay = perHour * t.mode.hours + 42;
    notes.push('Downstream: current of 3 mph added, plus 14 hours of floating (+42 miles a day) if someone guides the boat.');
  } else {
    const hours = t.mode.hours + (t.mode.water ? 0 : t.extraHours);
    perDay = perHour * hours;
  }
  if (!t.mode.water && t.extraHours > 0) {
    const dcs = Array.from({ length: t.extraHours }, (_, i) => 10 + 2 * (i + 1));
    notes.push(
      t.mode.group === 'Mounted'
        ? `Forced march: the mount's Constitution checks automatically fail; it takes 1d6 lethal damage each extra hour and becomes fatigued.`
        : `Forced march: each extra hour needs a Constitution check (DC ${dcs.join(', ')}); a failure deals 1d6 nonlethal damage and leaves the character fatigued.`,
    );
  }
  if (t.mode.water && !t.mode.downstream) notes.push('A sailing day is 24 hours of travel.');
  if (t.mode.downstream && !t.downstream) notes.push('Rowed boats travel 10 hours a day and can’t be rowed against any significant current.');
  const days = perDay > 0 ? t.miles / perDay : Infinity;
  const whole = Math.floor(days + 1e-9);
  // hours of travel in a day: 8 (+ forced march) on land, 10 rowed, 24 sailed or rowed-and-floated downstream
  const dayHours = t.mode.downstream && t.downstream ? 24 : t.mode.hours + (t.mode.water ? 0 : t.extraHours);
  const rest = (t.miles - whole * perDay) / (perDay / dayHours);
  return { perDay, days, hoursLastDay: Math.max(0, rest), multiplier, notes };
}

export const fmtMiles = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
