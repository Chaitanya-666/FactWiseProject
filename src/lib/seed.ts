// Deterministic demo data: a full facility (74/74) with a few days of history,
// plus ~160 past outcomes so the quality dashboard has something to show.
import { addDays, CAPACITY, Patient } from "./rules";

function rng(seed: number) {
  // mulberry32 — small seeded PRNG so "Reset demo" always gives the same data
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Diya", "Kabir", "Ananya", "Rohan", "Isha", "Vihaan", "Meera", "Arjun", "Saanvi",
  "Aditya", "Kavya", "Reyansh", "Tara", "Ishaan", "Riya", "Dev", "Nisha", "Kunal", "Pooja",
  "Rahul", "Sneha", "Om", "Asha", "Yash", "Neha", "Siddharth", "Priya", "Manav", "Zoya"];
const LAST = ["Sharma", "Patil", "Iyer", "Khan", "Deshmukh", "Reddy", "Joshi", "Nair", "Gupta", "Kulkarni",
  "Singh", "Mehta", "Rao", "Das", "Pillai", "Shah", "Bose", "Menon", "Jadhav", "Verma"];

export function seed(today: string): Patient[] {
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const between = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 10) / 10;
  const feverTemp = () => between(38.1, 40.0);
  const normalTemp = () => between(36.4, 37.6);
  const at = (day: string, h: number) => `${day}T${String(h).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}:00`;

  const patients: Patient[] = [];
  let n = 1;
  const id = () => `P${String(n++).padStart(4, "0")}`;

  // ---- past outcomes (closed cases) over the last 30 days ----
  for (let i = 0; i < 160; i++) {
    const outcomeOn = addDays(today, -1 - Math.floor(r() * 30));
    const stay = 4 + Math.floor(r() * 8);
    patients.push({
      id: id(),
      name: `${pick(FIRST)} ${pick(LAST)}`,
      age: 18 + Math.floor(r() * 65),
      room: null,
      admittedOn: addDays(outcomeOn, -stay),
      status: i % 7 === 3 ? "deceased" : "discharged", // ~14% mortality, just under benchmark
      temps: {},
      visits: {},
      outcomeOn,
    });
  }

  // ---- currently admitted: every room full ----
  for (let room = 1; room <= CAPACITY; room++) {
    const k = room % 10;
    // scenario mix so every screen has something to act on
    const scenario =
      k === 0 ? "approved" :         // doctor approved, waiting on admin
      k === 1 || k === 5 ? "eligible" : // 3 fever-free days, doctor hasn't approved yet
      k === 2 || k === 7 ? "almost" :   // 2 fever-free days — one more normal reading → eligible
      "sick";

    const daysIn = scenario === "sick" ? 1 + Math.floor(r() * 8) : 4 + Math.floor(r() * 5);
    const admittedOn = addDays(today, -daysIn);
    const normalDays = scenario === "almost" ? 2 : scenario === "sick" ? (r() < 0.4 ? 1 : 0) : 3 + Math.floor(r() * 2);
    const feverDays = Math.max(1, daysIn - normalDays);

    const p: Patient = {
      id: id(),
      name: `${pick(FIRST)} ${pick(LAST)}`,
      age: 18 + Math.floor(r() * 65),
      room,
      admittedOn,
      status: scenario === "approved" ? "discharge_approved" : "admitted",
      temps: {},
      visits: {},
    };
    for (let d = 0; d < daysIn; d++) {
      const day = addDays(admittedOn, d);
      p.temps[day] = { value: d < feverDays ? feverTemp() : normalTemp(), at: at(day, 8), by: "Nurse Asha" };
      p.visits[day] = { note: d < feverDays ? "Febrile. Continue antipyretics + fluids." : "Afebrile, stable.", at: at(day, 14), by: "Dr. Rao" };
    }
    if (scenario === "approved") p.approvedOn = addDays(today, -1);

    // morning rounds already under way: some temps taken, a few visits done
    if (room % 4 === 0) {
      const sickNow = scenario === "sick" && normalDays === 0;
      p.temps[today] = { value: sickNow ? feverTemp() : normalTemp(), at: at(today, 8), by: "Nurse Asha" };
      if (room % 12 === 0) p.visits[today] = { note: "Reviewed on morning round.", at: at(today, 10), by: "Dr. Rao" };
    }
    patients.push(p);
  }
  return patients;
}
