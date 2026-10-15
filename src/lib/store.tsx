"use client";
// Single source of truth for the prototype. State lives in React and is persisted to
// localStorage, so the demo needs no backend. Every action re-checks the rule from
// rules.ts before mutating — in production this check would live on the server.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  addDays, canAdmit, canApproveDischarge, canCorrectTemp, canLogTemp, canVisit,
  CRITICAL_C, freeRooms, isActive, isFever, Patient, todayStatus,
} from "./rules";
import { seed } from "./seed";

export interface ActivityEvent {
  at: string;
  day: string;
  actor: string;
  text: string;
  tone?: "info" | "warn" | "bad" | "good";
}

interface State {
  today: string;
  patients: Patient[];
  events: ActivityEvent[];
}

const KEY = "quarantrack-v1";
export const STAFF = { nurse: "Nurse Asha", doctor: "Dr. Rao", admin: "Admin Kiran", head: "Dr. Mehta (Head)" };

function realToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fresh(): State {
  const today = realToday();
  return { today, patients: seed(today), events: [{ at: new Date().toISOString(), day: today, actor: "System", text: "Demo data loaded — 74/74 rooms occupied." }] };
}

type Result = string | null; // error message, or null on success

interface Store extends State {
  logTemp(id: string, value: number): Result;
  correctTemp(id: string, value: number): Result;
  recordVisit(id: string, note: string): Result;
  approveDischarge(id: string): Result;
  markDeceased(id: string): Result;
  confirmDischarge(id: string): Result;
  admit(name: string, age: number): Result;
  remindDoctor(id: string): void;
  endDay(): void;
  reset(): void;
  get(id: string): Patient | undefined;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);

  // load once on the client (localStorage doesn't exist during server render)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      setState(raw ? JSON.parse(raw) : fresh());
    } catch {
      setState(fresh());
    }
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage blocked — demo still works in memory */
    }
  }, [state]);

  // Helper: validate against the current state, then apply an update to one patient.
  const act = useCallback(
    (id: string, check: (p: Patient, s: State) => Result, apply: (p: Patient, s: State) => Patient, event: (p: Patient) => Omit<ActivityEvent, "at" | "day">): Result => {
      if (!state) return "Loading…";
      const p = state.patients.find((x) => x.id === id);
      if (!p) return "Patient not found.";
      const err = check(p, state);
      if (err) return err;
      const next = apply(structuredClone(p), state);
      setState({
        ...state,
        patients: state.patients.map((x) => (x.id === id ? next : x)),
        events: [{ at: new Date().toISOString(), day: state.today, ...event(next) }, ...state.events].slice(0, 200),
      });
      return null;
    },
    [state],
  );

  if (!state) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading facility data…</div>;
  }

  const { today } = state;
  const now = () => new Date().toISOString();

  const store: Store = {
    ...state,
    get: (id) => state.patients.find((p) => p.id === id),

    logTemp: (id, value) =>
      act(id, (p) => canLogTemp(p, today, value), (p) => {
        p.temps[today] = { value, at: now(), by: STAFF.nurse };
        // fever after approval means they're not cured after all — pull the approval back
        if (p.status === "discharge_approved" && isFever(value)) {
          p.status = "admitted";
          p.approvedOn = undefined;
        }
        return p;
      }, (p) => ({
        actor: STAFF.nurse,
        text: `Recorded ${value.toFixed(1)} °C for ${p.name} (Room ${p.room})` + (value >= CRITICAL_C ? " — CRITICAL, doctor alerted" : ""),
        tone: value >= CRITICAL_C ? "bad" : isFever(value) ? "warn" : "info",
      })),

    correctTemp: (id, value) =>
      act(id, (p) => canCorrectTemp(p, today, value),
        (p) => {
          p.temps[today] = { value, at: now(), by: STAFF.nurse };
          return p;
        },
        (p) => ({ actor: STAFF.nurse, text: `Corrected today's reading for ${p.name} to ${value.toFixed(1)} °C`, tone: "warn" })),

    recordVisit: (id, note) =>
      act(id, (p) => canVisit(p, today), (p) => {
        p.visits[today] = { note: note.trim() || "Reviewed.", at: now(), by: STAFF.doctor };
        return p;
      }, (p) => ({ actor: STAFF.doctor, text: `Visited ${p.name} (Room ${p.room})` })),

    approveDischarge: (id) =>
      act(id, (p) => canApproveDischarge(p, today), (p) => {
        p.status = "discharge_approved";
        p.approvedOn = today;
        return p;
      }, (p) => ({ actor: STAFF.doctor, text: `Approved discharge for ${p.name} — sent to admin queue`, tone: "good" })),

    markDeceased: (id) =>
      act(id, (p) => (isActive(p) ? null : "Patient is no longer in the facility."), (p) => {
        p.status = "deceased";
        p.outcomeOn = today;
        p.room = null; // room released for the next admission
        return p;
      }, (p) => ({ actor: STAFF.doctor, text: `Recorded death of ${p.name}. Room released.`, tone: "bad" })),

    confirmDischarge: (id) => {
      let room: number | null = null;
      return act(id, (p) => (p.status === "discharge_approved" ? null : "Doctor has not approved this discharge."), (p) => {
        room = p.room;
        p.status = "discharged";
        p.outcomeOn = today;
        p.room = null;
        return p;
      }, (p) => ({ actor: STAFF.admin, text: `Discharged ${p.name}. Room ${room} is now free.`, tone: "good" }));
    },

    admit: (name, age) => {
      const err = canAdmit(state.patients) ?? (!name.trim() ? "Enter the patient's name." : null) ?? (!(age > 0 && age < 120) ? "Enter a valid age." : null);
      if (err) return err;
      const room = freeRooms(state.patients)[0];
      const id = `P${String(state.patients.length + 1).padStart(4, "0")}`;
      setState({
        ...state,
        patients: [...state.patients, { id, name: name.trim(), age, room, admittedOn: today, status: "admitted", temps: {}, visits: {} }],
        events: [{ at: now(), day: today, actor: STAFF.admin, text: `Admitted ${name.trim()} to Room ${room}`, tone: "info" as const }, ...state.events],
      });
      return null;
    },

    remindDoctor: (id) => {
      const p = state.patients.find((x) => x.id === id);
      if (!p) return;
      setState({ ...state, events: [{ at: now(), day: today, actor: STAFF.admin, text: `Reminded doctor: ${p.name} (Room ${p.room}) meets the 3-day cure criterion`, tone: "warn" }, ...state.events] });
    },

    // Demo control: close the day, log what was missed, move to tomorrow.
    endDay: () => {
      const active = state.patients.filter(isActive);
      const noTemp = active.filter((p) => todayStatus(p, today) === "temp_pending").length;
      const noVisit = active.filter((p) => todayStatus(p, today) !== "visited").length;
      const tone = noTemp || noVisit ? "warn" : "good";
      setState({
        ...state,
        today: addDays(today, 1),
        events: [{ at: now(), day: today, actor: "System", text: `Day closed: ${noTemp} missed temperature readings, ${noVisit} missed doctor visits.`, tone }, ...state.events],
      });
    },

    reset: () => setState(fresh()),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}
