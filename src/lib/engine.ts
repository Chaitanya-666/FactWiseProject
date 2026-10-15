// The whole app's behaviour as one pure function: dispatch(state, role, action) -> outcome.
// No React, no storage — so every rule can be tested directly (see tests/).
// In production this function would run on the server.
import {
  addDays, canAdmit, canApproveDischarge, canConfirmDischarge, canCorrectTemp, canLogTemp, canRole, canVisit,
  CRITICAL_C, freeRooms, isActive, isFever, needsRecheck, Patient, Role, todayStatus,
} from "./rules";

export interface ActivityEvent {
  at: string;
  day: string;
  actor: string;
  text: string;
  tone?: "info" | "warn" | "bad" | "good";
}

export interface State {
  today: string;
  patients: Patient[];
  events: ActivityEvent[];
}

export type Action =
  | { type: "logTemp"; id: string; value: number; confirmed?: boolean }
  | { type: "correctTemp"; id: string; value: number; reason: string; confirmed?: boolean }
  | { type: "recordVisit"; id: string; note: string }
  | { type: "approveDischarge"; id: string }
  | { type: "markDeceased"; id: string }
  | { type: "confirmDischarge"; id: string }
  | { type: "admit"; name: string; age: number }
  | { type: "remindDoctor"; id: string }
  | { type: "endDay" };

export type Outcome =
  | { ok: true; state: State }
  | { ok: false; error: string; needsConfirm?: boolean };

export const STAFF: Record<Role, string> = { nurse: "Nurse Asha", doctor: "Dr. Rao", admin: "Admin Kiran", head: "Dr. Mehta (Head)" };

const fail = (error: string, needsConfirm = false): Outcome => ({ ok: false, error, ...(needsConfirm && { needsConfirm }) });

export function dispatch(state: State, role: Role, action: Action, now = new Date().toISOString()): Outcome {
  if (!canRole(role, action.type)) return fail(`A ${role} cannot perform "${action.type}".`);
  const { today } = state;
  const log = (s: State, actor: string, text: string, tone: ActivityEvent["tone"] = "info"): State => ({
    ...s,
    events: [{ at: now, day: today, actor, text, tone }, ...s.events].slice(0, 300),
  });

  // helper for single-patient actions
  const withPatient = (id: string, f: (p: Patient) => Outcome | { patient: Patient; text: string; tone?: ActivityEvent["tone"] }): Outcome => {
    const p = state.patients.find((x) => x.id === id);
    if (!p) return fail("Patient not found.");
    const r = f(structuredClone(p));
    if ("ok" in r) return r;
    const next = { ...state, patients: state.patients.map((x) => (x.id === id ? r.patient : x)) };
    return { ok: true, state: log(next, STAFF[role], r.text, r.tone) };
  };

  // a fever after approval means not cured after all: revoke and flag for review
  const revokeIfFever = (p: Patient, value: number) => {
    if (p.status === "discharge_approved" && isFever(value)) {
      p.status = "admitted";
      p.approvedOn = undefined;
      p.flag = `Discharge approval revoked: ${value.toFixed(1)} °C recorded after approval — review.`;
      return true;
    }
    return false;
  };

  switch (action.type) {
    case "logTemp":
      return withPatient(action.id, (p) => {
        const err = canLogTemp(p, today, action.value);
        if (err) return fail(err);
        if (needsRecheck(action.value) && !action.confirmed)
          return fail(`${action.value.toFixed(1)} °C looks unusual — please re-check. Save anyway?`, true);
        p.temps[today] = { value: action.value, at: now, by: STAFF.nurse };
        const revoked = revokeIfFever(p, action.value);
        return {
          patient: p,
          text: `Recorded ${action.value.toFixed(1)} °C for ${p.name} (Room ${p.room})` +
            (action.value >= CRITICAL_C ? " — CRITICAL, doctor alerted" : "") + (revoked ? " — discharge approval revoked" : ""),
          tone: action.value >= CRITICAL_C || revoked ? "bad" : isFever(action.value) ? "warn" : "info",
        };
      });

    case "correctTemp":
      return withPatient(action.id, (p) => {
        const err = canCorrectTemp(p, today, action.value, action.reason);
        if (err) return fail(err);
        if (needsRecheck(action.value) && !action.confirmed)
          return fail(`${action.value.toFixed(1)} °C looks unusual — please re-check. Save anyway?`, true);
        const from = p.temps[today].value;
        p.corrections = [...(p.corrections ?? []), { day: today, from, to: action.value, reason: action.reason.trim(), at: now, by: STAFF.nurse }];
        p.temps[today] = { value: action.value, at: now, by: STAFF.nurse };
        const revoked = revokeIfFever(p, action.value);
        return { patient: p, text: `Corrected ${p.name}'s reading ${from.toFixed(1)} → ${action.value.toFixed(1)} °C (${action.reason.trim()})` + (revoked ? " — discharge approval revoked" : ""), tone: revoked ? "bad" : "warn" };
      });

    case "recordVisit":
      return withPatient(action.id, (p) => {
        const err = canVisit(p, today);
        if (err) return fail(err);
        p.visits[today] = { note: action.note.trim() || "Reviewed.", at: now, by: STAFF.doctor };
        p.flag = undefined; // doctor has reviewed
        return { patient: p, text: `Visited ${p.name} (Room ${p.room})` };
      });

    case "approveDischarge":
      return withPatient(action.id, (p) => {
        const err = canApproveDischarge(p, today);
        if (err) return fail(err);
        p.status = "discharge_approved";
        p.approvedOn = today;
        p.flag = undefined;
        return { patient: p, text: `Approved discharge for ${p.name} — sent to admin queue`, tone: "good" };
      });

    case "markDeceased":
      return withPatient(action.id, (p) => {
        if (!isActive(p)) return fail("Patient is not currently admitted.");
        p.status = "deceased";
        p.outcomeOn = today;
        p.flag = undefined;
        return { patient: p, text: `Recorded death of ${p.name}. Room ${p.room} to be released by admin.`, tone: "bad" };
      });

    case "confirmDischarge":
      return withPatient(action.id, (p) => {
        const err = canConfirmDischarge(p);
        if (err) return fail(err);
        const room = p.room;
        if (p.status === "discharge_approved") {
          p.status = "discharged";
          p.outcomeOn = today;
        }
        p.room = null;
        return { patient: p, text: p.status === "deceased" ? `Released Room ${room} (${p.name}, deceased).` : `Discharged ${p.name}. Room ${room} is now free.`, tone: "good" };
      });

    case "admit": {
      const err = canAdmit(state.patients, action.name, action.age);
      if (err) return fail(err);
      const room = freeRooms(state.patients)[0];
      const n = state.patients.reduce((m, p) => Math.max(m, parseInt(p.id.slice(1)) || 0), 0) + 1;
      const name = action.name.trim().replace(/\s+/g, " ");
      const patient: Patient = { id: `P${String(n).padStart(4, "0")}`, name, age: action.age, room, admittedOn: today, status: "admitted", temps: {}, visits: {} };
      return { ok: true, state: log({ ...state, patients: [...state.patients, patient] }, STAFF.admin, `Admitted ${name} to Room ${room}`) };
    }

    case "remindDoctor": {
      const p = state.patients.find((x) => x.id === action.id);
      if (!p) return fail("Patient not found.");
      return { ok: true, state: log(state, STAFF.admin, `Reminded doctor: ${p.name} (Room ${p.room}) meets the 3-day cure criterion`, "warn") };
    }

    case "endDay": {
      const active = state.patients.filter(isActive);
      const noTemp = active.filter((p) => todayStatus(p, today) === "temp_pending").length;
      const noVisit = active.filter((p) => todayStatus(p, today) !== "visited").length;
      const closed = log(state, "System", `Day closed: ${noTemp} missed temperature readings, ${noVisit} missed doctor visits.`, noTemp || noVisit ? "warn" : "good");
      return { ok: true, state: { ...closed, today: addDays(today, 1) } };
    }
  }
}
