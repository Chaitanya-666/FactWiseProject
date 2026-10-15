// Business rules for the facility. Everything here is a pure function of the data,
// so the same checks drive what the UI shows AND what the store allows.

export const CAPACITY = 74; // rooms in the facility
export const FEVER_C = 38.0; // a reading >= this counts as fever
export const CRITICAL_C = 40.5; // flag to doctor immediately
export const MIN_C = 34.0; // readings outside [MIN_C, MAX_C] are rejected as typos
export const MAX_C = 43.0;
export const CURE_DAYS = 3; // consecutive fever-free days => cured
export const BENCHMARK_MORTALITY = 0.15; // expected mortality (85% success)

export type Status = "admitted" | "discharge_approved" | "discharged" | "deceased";

export interface TempReading {
  value: number;
  at: string; // ISO timestamp
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
  room: number | null; // null once the patient has left
  admittedOn: string; // YYYY-MM-DD
  status: Status;
  temps: Record<string, TempReading>; // keyed by day, max one per day
  visits: Record<string, Visit>; // keyed by day, max one per day
  approvedOn?: string;
  outcomeOn?: string; // day discharged or deceased
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

export const isActive = (p: Patient) =>
  p.status === "admitted" || p.status === "discharge_approved";

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

// ---------- action guards: return an error message, or null if allowed ----------

export function validateReading(value: number): string | null {
  if (Number.isNaN(value)) return "Enter a temperature.";
  if (value < MIN_C || value > MAX_C)
    return `Reading must be between ${MIN_C} and ${MAX_C} °C — please re-measure.`;
  return null;
}

export function canLogTemp(p: Patient, today: string, value: number): string | null {
  if (!isActive(p)) return "Patient is no longer in the facility.";
  if (p.temps[today]) return "Temperature already recorded today.";
  return validateReading(value);
}

export function canCorrectTemp(p: Patient, today: string, value: number): string | null {
  if (!p.temps[today]) return "No reading today to correct.";
  if (p.visits[today]) return "Doctor has already reviewed today's reading.";
  return validateReading(value);
}

export function canVisit(p: Patient, today: string): string | null {
  if (!isActive(p)) return "Patient is no longer in the facility.";
  if (!p.temps[today]) return "Awaiting today's temperature from nurse.";
  if (p.visits[today]) return "Already visited today.";
  return null;
}

export function canApproveDischarge(p: Patient, today: string): string | null {
  if (p.status !== "admitted") return "Patient is not awaiting a discharge decision.";
  const s = normalStreak(p, today);
  if (s < CURE_DAYS) return `Only ${s}/${CURE_DAYS} fever-free days so far.`;
  return null;
}

export function canAdmit(patients: Patient[]): string | null {
  return freeRooms(patients).length === 0 ? "Facility is at full capacity (74/74)." : null;
}

export function freeRooms(patients: Patient[]): number[] {
  const taken = new Set(patients.filter(isActive).map((p) => p.room));
  return Array.from({ length: CAPACITY }, (_, i) => i + 1).filter((r) => !taken.has(r));
}

// ---------- quality metrics ----------

export function outcomeStats(patients: Patient[]) {
  const cured = patients.filter((p) => p.status === "discharged").length;
  const deceased = patients.filter((p) => p.status === "deceased").length;
  const closed = cured + deceased;
  const mortality = closed ? deceased / closed : 0;
  return { cured, deceased, closed, mortality, success: closed ? 1 - mortality : 0 };
}
