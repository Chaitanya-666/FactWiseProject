// Business rules for the facility. Everything here is a pure function of the data,
// so the same checks drive what the UI shows AND what the engine allows.

export const CAPACITY = 74; // rooms in the facility
export const FEVER_C = 38.0; // single setting: a reading >= this counts as fever
export const CRITICAL_C = 40.5; // flag to doctor immediately
export const MIN_C = 34.0; // outside [MIN_C, MAX_C] is physically implausible -> rejected
export const MAX_C = 43.0;
export const RECHECK_LOW_C = 35.0; // below this: ask nurse to re-check before saving
export const RECHECK_HIGH_C = 41.0; // above this: ask nurse to re-check before saving
export const CURE_DAYS = 3; // consecutive fever-free days => cured
export const BENCHMARK_MORTALITY = 0.15; // expected mortality (85% success)
export const OCCUPANCY_WARN = 0.9; // admin sees amber from 90% occupancy

export type Role = "nurse" | "doctor" | "admin" | "head";
export type Status = "admitted" | "discharge_approved" | "discharged" | "deceased";

export interface TempReading {
  value: number;
  at: string; // ISO timestamp
  by: string;
}

export interface Correction {
  day: string;
  from: number;
  to: number;
  reason: string;
  at: string;
  by: string;
}

export interface Visit {
  note: string;
  at: string;
  by: string;
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  room: number | null; // held until admin confirms the patient has physically left
  admittedOn: string; // YYYY-MM-DD
  status: Status;
  temps: Record<string, TempReading>; // keyed by day, max one per day
  visits: Record<string, Visit>; // keyed by day, max one per day
  corrections?: Correction[]; // readings are never deleted; corrections keep the old value
  approvedOn?: string;
  outcomeOn?: string; // day discharged or deceased
  flag?: string; // needs doctor review (e.g. fever after discharge approval)
}

export type TodayStatus = "temp_pending" | "ready_for_doctor" | "visited";

// ---------- dates (plain YYYY-MM-DD strings, no timezones) ----------

export function addDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function fmtDay(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// ---------- patient state ----------

/** Under clinical care: gets daily readings and visits. */
export const isActive = (p: Patient) =>
  p.status === "admitted" || p.status === "discharge_approved";

/** Holds a room (includes deceased patients until admin releases the room). */
export const occupiesRoom = (p: Patient) => p.room !== null;

export const isFever = (c: number) => c >= FEVER_C;

/**
 * Consecutive fever-free days ending at the latest day.
 * If today's reading isn't in yet, count back from yesterday so a patient
 * doesn't "lose" their streak just because the nurse hasn't come by yet.
 * A missing day breaks the streak — the cure rule needs FULL days of evidence.
 */
export function normalStreak(p: Patient, today: string): number {
  let day = p.temps[today] ? today : addDays(today, -1);
  let streak = 0;
  while (p.temps[day] && !isFever(p.temps[day].value)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export const isEligibleForDischarge = (p: Patient, today: string) =>
  p.status === "admitted" && normalStreak(p, today) >= CURE_DAYS;

export function todayStatus(p: Patient, today: string): TodayStatus {
  if (p.visits[today]) return "visited";
  if (p.temps[today]) return "ready_for_doctor";
  return "temp_pending";
}

// ---------- roles ----------

export const PERMISSIONS = {
  logTemp: ["nurse"],
  correctTemp: ["nurse"],
  recordVisit: ["doctor"],
  approveDischarge: ["doctor"],
  markDeceased: ["doctor"],
  confirmDischarge: ["admin"], // also releases the room of a deceased patient
  admit: ["admin"],
  remindDoctor: ["admin"],
  endDay: ["nurse", "doctor", "admin", "head"], // demo control only
} as const satisfies Record<string, readonly Role[]>;

export type ActionType = keyof typeof PERMISSIONS;

export const canRole = (role: Role, action: ActionType) =>
  (PERMISSIONS[action] as readonly Role[]).includes(role);

// ---------- action guards: return an error message, or null if allowed ----------

export function validateReading(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
  if (value < MIN_C || value > MAX_C)
    return `Reading must be between ${MIN_C} and ${MAX_C} °C — please re-measure.`;
  return null;
}

/** Plausible but unusual readings: allowed only after the nurse confirms a re-check. */
export function needsRecheck(value: number): boolean {
  return value < RECHECK_LOW_C || value > RECHECK_HIGH_C;
}

export function canLogTemp(p: Patient, today: string, value: unknown): string | null {
  if (!isActive(p)) return "Patient is not currently admitted.";
  if (p.temps[today]) return "Temperature already recorded today.";
  return validateReading(value);
}

export function canCorrectTemp(p: Patient, today: string, value: unknown, reason = "x"): string | null {
  if (!isActive(p)) return "Patient is not currently admitted.";
  if (!p.temps[today]) return "No reading today to correct.";
  if (p.visits[today]) return "Doctor has already reviewed today's reading.";
  if (!reason.trim()) return "Give a reason for the correction.";
  return validateReading(value);
}

export function canVisit(p: Patient, today: string): string | null {
  if (!isActive(p)) return "Patient is not currently admitted.";
  if (!p.temps[today]) return "Temperature not recorded yet.";
  if (p.visits[today]) return "Already visited today.";
  return null;
}

export function canApproveDischarge(p: Patient, today: string): string | null {
  if (p.status !== "admitted") return "Patient is not awaiting a discharge decision.";
  const s = normalStreak(p, today);
  if (s < CURE_DAYS) return `Not eligible: only ${s}/${CURE_DAYS} fever-free days so far.`;
  return null;
}

export function canConfirmDischarge(p: Patient): string | null {
  if (p.status === "discharge_approved") return null;
  if (p.status === "deceased" && p.room !== null) return null;
  return "Doctor has not approved this discharge.";
}

export const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function canAdmit(patients: Patient[], name = "x", age = 30): string | null {
  if (freeRooms(patients).length === 0) return "No rooms available.";
  if (!name.trim()) return "Enter the patient's name.";
  if (!Number.isInteger(age) || age <= 0 || age >= 120) return "Enter a valid age.";
  const dup = patients.find((p) => occupiesRoom(p) && isActive(p) && normName(p.name) === normName(name) && p.age === age);
  if (dup) return `${dup.name} (${dup.age}) is already admitted in Room ${dup.room}.`;
  return null;
}

export function freeRooms(patients: Patient[]): number[] {
  const taken = new Set(patients.filter(occupiesRoom).map((p) => p.room));
  return Array.from({ length: CAPACITY }, (_, i) => i + 1).filter((r) => !taken.has(r));
}

export function occupancyLevel(occupied: number): "ok" | "warn" | "full" {
  if (occupied >= CAPACITY) return "full";
  if (occupied >= Math.ceil(CAPACITY * OCCUPANCY_WARN)) return "warn";
  return "ok";
}

// ---------- quality metrics ----------

export function outcomeStats(patients: Patient[]) {
  const cured = patients.filter((p) => p.status === "discharged").length;
  const deceased = patients.filter((p) => p.status === "deceased").length;
  const closed = cured + deceased;
  const mortality = closed ? deceased / closed : 0;
  return { cured, deceased, closed, mortality, success: closed ? 1 - mortality : 0, overBenchmark: mortality > BENCHMARK_MORTALITY };
}
