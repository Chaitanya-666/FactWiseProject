// Rigorous checks of every business rule, organised by the Q3 constraint they enforce.
// Data-driven (it.each over boundary values) + a randomised 30-day simulation that
// asserts invariants after every single action.
import { describe, expect, it } from "vitest";
import { Action, dispatch, Outcome, State } from "../src/lib/engine";
import {
  addDays, CAPACITY, CURE_DAYS, FEVER_C, freeRooms, isActive, isEligibleForDischarge, normalStreak,
  occupancyLevel, occupiesRoom, outcomeStats, Patient, PERMISSIONS, Role,
} from "../src/lib/rules";
import { seed } from "../src/lib/seed";

const T = "2026-10-15";
const ROLES: Role[] = ["nurse", "doctor", "admin", "head"];

// ---------- fixtures ----------
function patient(over: Partial<Patient> = {}, temps: Record<number, number> = {}): Patient {
  // temps keyed by "days ago" (0 = today)
  return {
    id: "P9001", name: "Test Patient", age: 40, room: 1, admittedOn: addDays(T, -10), status: "admitted", visits: {},
    temps: Object.fromEntries(Object.entries(temps).map(([ago, v]) => [addDays(T, -Number(ago)), { value: v, at: "", by: "" }])),
    ...over,
  };
}
const state = (patients: Patient[], today = T): State => ({ today, patients, events: [] });
const ok = (o: Outcome): State => {
  if (!o.ok) throw new Error(`expected success, got: ${o.error}`);
  return o.state;
};
const err = (o: Outcome): string => {
  if (o.ok) throw new Error("expected failure, got success");
  return o.error;
};
const p0 = (s: State) => s.patients[0];
const cured3 = { 1: 37, 2: 36.8, 3: 37.1 }; // 3 fever-free days ending yesterday

// ===================================================================================
describe("Temperature 1 — only one reading per patient per day", () => {
  it("second reading the same day is blocked with 'already recorded'", () => {
    const s = ok(dispatch(state([patient()]), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    expect(err(dispatch(s, "nurse", { type: "logTemp", id: "P9001", value: 37.2 }))).toMatch(/already recorded today/i);
  });
  it("first reading of the NEXT day is allowed again", () => {
    let s = ok(dispatch(state([patient()]), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    s = ok(dispatch(s, "head", { type: "endDay" }));
    s = ok(dispatch(s, "nurse", { type: "logTemp", id: "P9001", value: 37.1 }));
    expect(Object.keys(p0(s).temps)).toHaveLength(2);
  });
  it("a blocked duplicate does not change the stored value", () => {
    const s = ok(dispatch(state([patient()]), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    dispatch(s, "nurse", { type: "logTemp", id: "P9001", value: 39 });
    expect(p0(s).temps[T].value).toBe(37);
  });
});

describe("Temperature 2 — only for today and only for currently admitted patients", () => {
  it.each(["discharged", "deceased"] as const)("rejects readings for a %s patient", (status) => {
    expect(err(dispatch(state([patient({ status })]), "nurse", { type: "logTemp", id: "P9001", value: 37 }))).toMatch(/not currently admitted/i);
  });
  it("accepts readings for a discharge-approved patient who is still in the room", () => {
    ok(dispatch(state([patient({ status: "discharge_approved" }, cured3)]), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
  });
  it("reading is always stored against the facility's current day", () => {
    const s = ok(dispatch(state([patient()], "2026-12-31"), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    expect(Object.keys(p0(s).temps)).toEqual(["2026-12-31"]);
  });
  it("unknown patient id is rejected", () => {
    expect(err(dispatch(state([patient()]), "nurse", { type: "logTemp", id: "NOPE", value: 37 }))).toMatch(/not found/i);
  });
});

describe("Temperature 3 — warn below 35 / above 41 so the nurse re-checks; reject non-numbers", () => {
  // value, expected: "save" (no warning), "recheck" (needs confirm), "reject" (never saved)
  const cases: [unknown, "save" | "recheck" | "reject"][] = [
    [NaN, "reject"], [Infinity, "reject"], [-Infinity, "reject"], ["37" as unknown, "reject"], [null, "reject"], [undefined, "reject"],
    [0, "reject"], [-37, "reject"], [33.9, "reject"], [100.4, "reject"], [43.1, "reject"], [98.6, "reject"],
    [34.0, "recheck"], [34.9, "recheck"], [41.1, "recheck"], [43.0, "recheck"],
    [35.0, "save"], [36.6, "save"], [37.9, "save"], [38.0, "save"], [40.5, "save"], [41.0, "save"],
  ];
  it.each(cases)("%s °C → %s", (value, expected) => {
    const s0 = state([patient()]);
    const first = dispatch(s0, "nurse", { type: "logTemp", id: "P9001", value: value as number });
    if (expected === "save") return void expect(p0(ok(first)).temps[T].value).toBe(value);
    expect(first.ok).toBe(false);
    if (expected === "reject") {
      expect((first as { needsConfirm?: boolean }).needsConfirm).toBeFalsy();
      // even with confirmation it must not be saved
      expect(dispatch(s0, "nurse", { type: "logTemp", id: "P9001", value: value as number, confirmed: true }).ok).toBe(false);
    } else {
      expect(err(first)).toMatch(/re-check/i);
      expect((first as { needsConfirm?: boolean }).needsConfirm).toBe(true);
      expect(p0(ok(dispatch(s0, "nurse", { type: "logTemp", id: "P9001", value: value as number, confirmed: true }))).temps[T].value).toBe(value);
    }
  });
});

describe("Temperature 4 — nobody can delete a reading; corrections keep old value and reason", () => {
  const logged = () => ok(dispatch(state([patient()]), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
  it("correction stores old value, new value and reason", () => {
    const s = ok(dispatch(logged(), "nurse", { type: "correctTemp", id: "P9001", value: 37.4, reason: "Mistyped" }));
    expect(p0(s).temps[T].value).toBe(37.4);
    expect(p0(s).corrections).toEqual([expect.objectContaining({ day: T, from: 37, to: 37.4, reason: "Mistyped" })]);
  });
  it("multiple corrections are all kept, in order", () => {
    let s = ok(dispatch(logged(), "nurse", { type: "correctTemp", id: "P9001", value: 37.4, reason: "a" }));
    s = ok(dispatch(s, "nurse", { type: "correctTemp", id: "P9001", value: 37.2, reason: "b" }));
    expect(p0(s).corrections!.map((c) => [c.from, c.to])).toEqual([[37, 37.4], [37.4, 37.2]]);
  });
  it.each(["", "   "])("reason %j is required", (reason) => {
    expect(err(dispatch(logged(), "nurse", { type: "correctTemp", id: "P9001", value: 37.4, reason }))).toMatch(/reason/i);
  });
  it("cannot correct when there is no reading today", () => {
    expect(err(dispatch(state([patient()]), "nurse", { type: "correctTemp", id: "P9001", value: 37, reason: "x" }))).toMatch(/no reading/i);
  });
  it("cannot correct after the doctor has reviewed it", () => {
    const s = ok(dispatch(logged(), "doctor", { type: "recordVisit", id: "P9001", note: "" }));
    expect(err(dispatch(s, "nurse", { type: "correctTemp", id: "P9001", value: 39, reason: "x" }))).toMatch(/already reviewed/i);
  });
  it("corrections obey the same range / re-check rules", () => {
    expect(err(dispatch(logged(), "nurse", { type: "correctTemp", id: "P9001", value: 100.4, reason: "F" }))).toMatch(/between/);
    expect(dispatch(logged(), "nurse", { type: "correctTemp", id: "P9001", value: 41.5, reason: "x" })).toMatchObject({ ok: false, needsConfirm: true });
  });
  it("there is no delete action at all", () => {
    expect(Object.keys(PERMISSIONS).some((a) => /delete|remove/i.test(a))).toBe(false);
  });
});

describe("Temperature 5 — fever limit is a single setting", () => {
  it.each([[FEVER_C - 0.1, false], [FEVER_C, true], [FEVER_C + 0.1, true]])("%s °C fever=%s drives the streak", (v, fever) => {
    expect(normalStreak(patient({}, { 0: v }), T)).toBe(fever ? 0 : 1);
  });
});

// ===================================================================================
describe("Doctor 1 — no visit until today's temperature is recorded", () => {
  it("visit is refused with 'Temperature not recorded yet'", () => {
    expect(err(dispatch(state([patient()]), "doctor", { type: "recordVisit", id: "P9001", note: "" }))).toBe("Temperature not recorded yet.");
  });
  it("yesterday's reading does not count for today", () => {
    expect(dispatch(state([patient({}, { 1: 37 })]), "doctor", { type: "recordVisit", id: "P9001", note: "" }).ok).toBe(false);
  });
  it("visit allowed once the nurse records today's reading", () => {
    const s = ok(dispatch(state([patient()]), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    expect(p0(ok(dispatch(s, "doctor", { type: "recordVisit", id: "P9001", note: "  ok " }))).visits[T].note).toBe("ok");
  });
});

describe("Doctor 2 — one visit per patient per day", () => {
  it("second visit is refused", () => {
    let s = ok(dispatch(state([patient({}, { 0: 37 })]), "doctor", { type: "recordVisit", id: "P9001", note: "" }));
    expect(err(dispatch(s, "doctor", { type: "recordVisit", id: "P9001", note: "" }))).toMatch(/already visited/i);
    s = ok(dispatch(s, "head", { type: "endDay" }));
    s = ok(dispatch(s, "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    ok(dispatch(s, "doctor", { type: "recordVisit", id: "P9001", note: "" })); // next day is fine
  });
  it.each(["discharged", "deceased"] as const)("no visit for a %s patient", (status) => {
    expect(dispatch(state([patient({ status }, { 0: 37 })]), "doctor", { type: "recordVisit", id: "P9001", note: "" }).ok).toBe(false);
  });
});

// ===================================================================================
describe("Discharge 1 — eligible only after 3 full days in a row, recorded and fever-free", () => {
  // temps keyed by days-ago → expected eligibility
  const cases: [string, Record<number, number>, boolean][] = [
    ["3 normal days ending yesterday", { 1: 37, 2: 37, 3: 37 }, true],
    ["today + 2 previous normal", { 0: 37, 1: 37, 2: 37 }, true],
    ["4 normal days", { 0: 37, 1: 37, 2: 37, 3: 37 }, true],
    ["only 2 normal days", { 1: 37, 2: 37, 3: 39 }, false],
    ["fever today resets", { 0: 38, 1: 37, 2: 37, 3: 37 }, false],
    ["fever exactly at limit yesterday", { 1: 38.0, 2: 37, 3: 37, 4: 37 }, false],
    ["37.9 counts as no fever", { 1: 37.9, 2: 37.9, 3: 37.9 }, true],
    ["missing day in the middle", { 1: 37, 3: 37, 4: 37 }, false],
    ["missing yesterday (today not taken)", { 2: 37, 3: 37, 4: 37 }, false],
    ["no readings at all", {}, false],
    ["fever after 3 normal days", { 1: 39, 2: 37, 3: 37, 4: 37 }, false],
  ];
  it.each(cases)("%s → eligible=%s", (_, temps, expected) => {
    expect(isEligibleForDischarge(patient({}, temps), T)).toBe(expected);
  });
});

describe("Discharge 2 — only a doctor approves, and only when eligible", () => {
  it.each(ROLES.filter((r) => r !== "doctor"))("%s cannot approve", (role) => {
    expect(err(dispatch(state([patient({}, cured3)]), role, { type: "approveDischarge", id: "P9001" }))).toMatch(/cannot/);
  });
  it("doctor is blocked when not eligible, with the reason", () => {
    expect(err(dispatch(state([patient({}, { 1: 37, 2: 37 })]), "doctor", { type: "approveDischarge", id: "P9001" }))).toMatch(/2\/3/);
  });
  it("doctor approval moves the patient to the admin queue (room still held)", () => {
    const p = p0(ok(dispatch(state([patient({}, cured3)]), "doctor", { type: "approveDischarge", id: "P9001" })));
    expect(p).toMatchObject({ status: "discharge_approved", approvedOn: T, room: 1 });
  });
  it("cannot approve twice", () => {
    const s = ok(dispatch(state([patient({}, cured3)]), "doctor", { type: "approveDischarge", id: "P9001" }));
    expect(dispatch(s, "doctor", { type: "approveDischarge", id: "P9001" }).ok).toBe(false);
  });
});

describe("Discharge 3 — fever after approval but before leaving is flagged for doctor review", () => {
  const approved = () => ok(dispatch(state([patient({}, cured3)]), "doctor", { type: "approveDischarge", id: "P9001" }));
  it("new fever reading revokes approval and flags the patient", () => {
    const p = p0(ok(dispatch(approved(), "nurse", { type: "logTemp", id: "P9001", value: 38.5 })));
    expect(p.status).toBe("admitted");
    expect(p.approvedOn).toBeUndefined();
    expect(p.flag).toMatch(/revoked/i);
  });
  it("a CORRECTION to a fever value also revokes (no loophole)", () => {
    let s = ok(dispatch(approved(), "nurse", { type: "logTemp", id: "P9001", value: 37 }));
    s = ok(dispatch(s, "nurse", { type: "correctTemp", id: "P9001", value: 38.6, reason: "re-measured" }));
    expect(p0(s)).toMatchObject({ status: "admitted", flag: expect.stringMatching(/revoked/) });
  });
  it("admin can no longer discharge once revoked", () => {
    const s = ok(dispatch(approved(), "nurse", { type: "logTemp", id: "P9001", value: 39 }));
    expect(err(dispatch(s, "admin", { type: "confirmDischarge", id: "P9001" }))).toMatch(/not approved/i);
  });
  it("normal reading after approval keeps it approved", () => {
    expect(p0(ok(dispatch(approved(), "nurse", { type: "logTemp", id: "P9001", value: 37.2 }))).status).toBe("discharge_approved");
  });
  it("doctor visit clears the review flag", () => {
    const s = ok(dispatch(approved(), "nurse", { type: "logTemp", id: "P9001", value: 39 }));
    expect(p0(ok(dispatch(s, "doctor", { type: "recordVisit", id: "P9001", note: "" }))).flag).toBeUndefined();
  });
});

// ===================================================================================
describe("Rooms 1 — maximum 74; admit disabled with 'No rooms available'", () => {
  const full = () => state(seed(T));
  it("seeded facility is exactly full", () => {
    expect(full().patients.filter(occupiesRoom)).toHaveLength(CAPACITY);
    expect(freeRooms(full().patients)).toEqual([]);
  });
  it("75th admission is refused", () => {
    expect(err(dispatch(full(), "admin", { type: "admit", name: "New Person", age: 30 }))).toBe("No rooms available.");
  });
  it("admitting into an empty facility fills rooms 1..74 then stops", () => {
    let s = state([]);
    for (let i = 0; i < CAPACITY; i++) s = ok(dispatch(s, "admin", { type: "admit", name: `Person ${i}`, age: 30 }));
    expect(s.patients.map((p) => p.room).sort((a, b) => a! - b!)).toEqual(Array.from({ length: CAPACITY }, (_, i) => i + 1));
    expect(err(dispatch(s, "admin", { type: "admit", name: "One More", age: 30 }))).toBe("No rooms available.");
  });
  it.each([["", 30], ["   ", 30], ["Ok Name", 0], ["Ok Name", -1], ["Ok Name", 120], ["Ok Name", 25.5], ["Ok Name", NaN]])("invalid input name=%j age=%s is refused", (name, age) => {
    expect(dispatch(state([]), "admin", { type: "admit", name, age }).ok).toBe(false);
  });
  it("new patient gets the lowest free room and a unique id", () => {
    const s = ok(dispatch(state([patient({ room: 1 }), patient({ id: "P9002", name: "B", room: 3 })]), "admin", { type: "admit", name: "C", age: 20 }));
    const np = s.patients.at(-1)!;
    expect(np.room).toBe(2);
    expect(new Set(s.patients.map((p) => p.id)).size).toBe(3);
  });
});

describe("Rooms 2 — room freed only when admin confirms the patient physically left", () => {
  it("doctor approval does NOT free the room", () => {
    const s = ok(dispatch(state([patient({}, cured3)]), "doctor", { type: "approveDischarge", id: "P9001" }));
    expect(freeRooms(s.patients)).not.toContain(1);
  });
  it("admin confirmation frees it and records the outcome", () => {
    let s = ok(dispatch(state([patient({}, cured3)]), "doctor", { type: "approveDischarge", id: "P9001" }));
    s = ok(dispatch(s, "admin", { type: "confirmDischarge", id: "P9001" }));
    expect(p0(s)).toMatchObject({ status: "discharged", room: null, outcomeOn: T });
    expect(freeRooms(s.patients)).toContain(1);
  });
  it("death keeps the room until admin releases it", () => {
    let s = ok(dispatch(state([patient()]), "doctor", { type: "markDeceased", id: "P9001" }));
    expect(p0(s)).toMatchObject({ status: "deceased", room: 1 });
    s = ok(dispatch(s, "admin", { type: "confirmDischarge", id: "P9001" }));
    expect(p0(s)).toMatchObject({ status: "deceased", room: null });
  });
  it("admin cannot discharge a patient the doctor has not approved", () => {
    expect(err(dispatch(state([patient({}, cured3)]), "admin", { type: "confirmDischarge", id: "P9001" }))).toMatch(/not approved/i);
  });
  it("cannot discharge the same patient twice", () => {
    let s = ok(dispatch(state([patient({ status: "discharge_approved" })]), "admin", { type: "confirmDischarge", id: "P9001" }));
    expect(dispatch(s, "admin", { type: "confirmDischarge", id: "P9001" }).ok).toBe(false);
    s = ok(dispatch(s, "admin", { type: "admit", name: "Next", age: 50 }));
    expect(s.patients.at(-1)!.room).toBe(1); // freed room reused
  });
});

describe("Rooms 3 — same patient cannot be admitted twice at the same time", () => {
  const base = () => state([patient({ name: "Asha Rao", age: 40 })]);
  it.each(["Asha Rao", "asha rao", "  ASHA   RAO "])("duplicate %j (age 40) is refused", (name) => {
    expect(err(dispatch(base(), "admin", { type: "admit", name, age: 40 }))).toMatch(/already admitted/i);
  });
  it("same name but different age is a different person", () => {
    ok(dispatch(base(), "admin", { type: "admit", name: "Asha Rao", age: 41 }));
  });
  it("can be re-admitted after being discharged", () => {
    ok(dispatch(state([patient({ name: "Asha Rao", age: 40, status: "discharged", room: null })]), "admin", { type: "admit", name: "Asha Rao", age: 40 }));
  });
});

// ===================================================================================
describe("Roles — who can do what", () => {
  const expected: Record<Role, string[]> = {
    nurse: ["logTemp", "correctTemp", "endDay"],
    doctor: ["recordVisit", "approveDischarge", "markDeceased", "endDay"],
    admin: ["confirmDischarge", "admit", "remindDoctor", "endDay"],
    head: ["endDay"], // head doctor: view dashboard & reports only
  };
  const actions: Action[] = [
    { type: "logTemp", id: "P9001", value: 37 },
    { type: "correctTemp", id: "P9001", value: 37, reason: "x" },
    { type: "recordVisit", id: "P9001", note: "" },
    { type: "approveDischarge", id: "P9001" },
    { type: "markDeceased", id: "P9001" },
    { type: "confirmDischarge", id: "P9001" },
    { type: "admit", name: "X", age: 30 },
    { type: "remindDoctor", id: "P9001" },
  ];
  const matrix = ROLES.flatMap((r) => actions.map((a) => [r, a.type, expected[r].includes(a.type), a] as const));
  it.each(matrix)("%s → %s allowed=%s", (role, _t, allowed, action) => {
    const o = dispatch(state([patient({}, cured3)]), role, action);
    if (allowed) expect(o.ok || !/cannot perform/.test((o as { error: string }).error)).toBe(true);
    else expect(err(o)).toMatch(/cannot perform/);
  });
  it("a refused action never changes state", () => {
    const s = state([patient({}, cured3)]);
    const before = JSON.stringify(s);
    for (const a of actions) dispatch(s, "head", a);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ===================================================================================
describe("Warnings — occupancy thresholds and mortality", () => {
  it.each([[0, "ok"], [66, "ok"], [67, "warn"], [73, "warn"], [74, "full"]] as const)("%i/74 beds → %s", (n, level) => {
    expect(occupancyLevel(n)).toBe(level);
  });
  const closed = (cured: number, dead: number) => [
    ...Array.from({ length: cured }, (_, i) => patient({ id: `C${i}`, status: "discharged", room: null })),
    ...Array.from({ length: dead }, (_, i) => patient({ id: `D${i}`, status: "deceased", room: null })),
  ];
  it.each([
    [0, 0, 0, false], [85, 15, 0.15, false], [84, 16, 0.16, true], [100, 0, 0, false], [0, 1, 1, true], [17, 3, 0.15, false],
  ])("cured=%i deceased=%i → mortality %f, alert=%s", (c, d, m, alert) => {
    const s = outcomeStats(closed(c, d));
    expect(s.mortality).toBeCloseTo(m, 10);
    expect(s.overBenchmark).toBe(alert);
    expect(s.closed).toBe(c + d);
  });
  it("patients still admitted are not counted", () => {
    const s = outcomeStats([...closed(9, 1), patient({ id: "A1" }), patient({ id: "A2", status: "discharge_approved" })]);
    expect(s).toMatchObject({ closed: 10, mortality: 0.1 });
  });
  it("end of day logs missed readings and visits", () => {
    const s = ok(dispatch(state([patient(), patient({ id: "P9002", name: "B", room: 2 }, { 0: 37 })]), "head", { type: "endDay" }));
    expect(s.today).toBe(addDays(T, 1));
    expect(s.events[0].text).toMatch(/1 missed temperature readings, 2 missed doctor visits/);
  });
});

// ===================================================================================
describe("Simulation — 30 random days, invariants checked after every action", () => {
  function rng(seed: number) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  // plain checks (no expect() per patient) so thousands of steps stay fast
  const invariants = (s: State) => {
    const bad = (m: string) => { throw new Error(`invariant broken: ${m}`); };
    const rooms = s.patients.filter(occupiesRoom).map((p) => p.room!);
    if (rooms.length > CAPACITY) bad("over capacity");
    if (new Set(rooms).size !== rooms.length) bad("two patients share a room");
    if (rooms.some((r) => r < 1 || r > CAPACITY)) bad("room out of range");
    if (new Set(s.patients.map((p) => p.id)).size !== s.patients.length) bad("duplicate id");
    for (const p of s.patients) {
      if (isActive(p) && p.room === null) bad(`${p.id} active without a room`);
      if (p.status === "discharged" && p.room !== null) bad(`${p.id} discharged but holds a room`);
      if (p.status === "discharge_approved" && !p.approvedOn) bad(`${p.id} approved without date`);
      for (const day of Object.keys(p.visits)) if (!p.temps[day]) bad(`${p.id} visited before reading on ${day}`);
      for (const t of Object.values(p.temps)) if (!(t.value >= 34 && t.value <= 43)) bad(`${p.id} stored invalid reading ${t.value}`);
    }
  };

  it.each([1, 7, 42, 1234, 99999])("seed %i: thousands of random actions keep every invariant", (sd) => {
    const r = rng(sd);
    let s = state(seed(T));
    let applied = 0, refused = 0;
    for (let day = 0; day < 30; day++) {
      for (let k = 0; k < 150; k++) {
        const ids = s.patients.map((p) => p.id);
        const id = ids[Math.floor(r() * ids.length)];
        
        const v = Math.round((33 + r() * 11) * 10) / 10;
        const candidates: Action[] = [
          { type: "logTemp", id, value: v, confirmed: r() < 0.5 },
          { type: "correctTemp", id, value: v, reason: r() < 0.8 ? "fix" : "" },
          { type: "recordVisit", id, note: "n" },
          { type: "approveDischarge", id },
          { type: "markDeceased", id },
          { type: "confirmDischarge", id },
          { type: "admit", name: `Sim ${Math.floor(r() * 500)}`, age: 20 + Math.floor(r() * 60) },
        ];
        const a = candidates[Math.floor(r() * candidates.length)];
        // mostly the right role, sometimes a wrong one (must be refused)
        const allowed = PERMISSIONS[a.type] as readonly Role[];
        const role = r() < 0.85 ? allowed[0] : ROLES[Math.floor(r() * 4)];
        // deaths are rare in reality — keep the sim from emptying the ward
        if (a.type === "markDeceased" && r() > 0.05) continue;
        const o = dispatch(s, role, a);
        if (o.ok) { s = o.state; applied++; } else refused++; // refusal returns no state, so s is untouched by construction
        invariants(s);
      }
      s = ok(dispatch(s, "head", { type: "endDay" }));
    }
    expect(applied).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it("every discharge in a simulation was preceded by 3 fever-free days at approval time", () => {
    let s = state(seed(T));
    for (let day = 0; day < 10; day++) {
      for (const p of s.patients.filter(isActive)) {
        if (!p.temps[s.today]) s = ok(dispatch(s, "nurse", { type: "logTemp", id: p.id, value: 36.8 }));
        if (!p.visits[s.today]) s = ok(dispatch(s, "doctor", { type: "recordVisit", id: p.id, note: "" }));
        const cur = s.patients.find((x) => x.id === p.id)!;
        if (isEligibleForDischarge(cur, s.today)) {
          expect(normalStreak(cur, s.today)).toBeGreaterThanOrEqual(CURE_DAYS);
          s = ok(dispatch(s, "doctor", { type: "approveDischarge", id: p.id }));
        }
        if (s.patients.find((x) => x.id === p.id)!.status === "discharge_approved")
          s = ok(dispatch(s, "admin", { type: "confirmDischarge", id: p.id }));
      }
      s = ok(dispatch(s, "head", { type: "endDay" }));
    }
    // with everyone afebrile for 10 days, the ward must have been emptied by discharges
    expect(s.patients.filter(occupiesRoom)).toHaveLength(0);
  });
});
