"use client";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "@/lib/store";
import { addDays, BENCHMARK_MORTALITY, CAPACITY, daysBetween, fmtDay, isActive, isEligibleForDischarge, outcomeStats, todayStatus } from "@/lib/rules";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function Dashboard() {
  const { patients, today, events } = useStore();
  const s = outcomeStats(patients);
  const active = patients.filter(isActive);
  const tempsDone = active.filter((p) => todayStatus(p, today) !== "temp_pending").length;
  const visitsDone = active.filter((p) => todayStatus(p, today) === "visited").length;
  const over = s.mortality > BENCHMARK_MORTALITY;
  const discharged = patients.filter((p) => p.status === "discharged");
  const avgStay = discharged.length ? discharged.reduce((n, p) => n + daysBetween(p.admittedOn, p.outcomeOn!), 0) / discharged.length : 0;

  // rolling 14-day mortality rate over closed cases, plotted for the last 30 days
  const trend = Array.from({ length: 30 }, (_, i) => {
    const day = addDays(today, i - 29);
    const from = addDays(day, -13);
    const win = patients.filter((p) => p.outcomeOn && p.outcomeOn >= from && p.outcomeOn <= day);
    const d = win.filter((p) => p.status === "deceased").length;
    return { day: fmtDay(day), rate: win.length ? +((d / win.length) * 100).toFixed(1) : null };
  });

  return (
    <>
      <PageHeader title="Quality dashboard" subtitle="Treatment outcomes against the 85% success benchmark, plus today's process compliance." />
      {over && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><b>Alert:</b> mortality rate {pct(s.mortality)} is above the expected {pct(BENCHMARK_MORTALITY)}. Review treatment protocols.</div>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Success rate" value={pct(s.success)} tone={over ? "red" : "green"} sub={`Benchmark 85% · ${s.cured} cured`} />
        <Stat label="Mortality rate" value={pct(s.mortality)} tone={over ? "red" : "green"} sub={`${s.deceased} of ${s.closed} closed cases`} />
        <Stat label="Occupancy" value={`${active.length}/${CAPACITY}`} tone="blue" sub={`${active.filter((p) => isEligibleForDischarge(p, today) || p.status === "discharge_approved").length} ready to leave`} />
        <Stat label="Avg stay (cured)" value={`${avgStay.toFixed(1)} d`} tone="violet" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Mortality rate — rolling 14 days" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} />
                <YAxis unit="%" tick={{ fontSize: 11 }} domain={[0, 30]} ticks={[0, 10, 15, 20, 30]} />
                <Tooltip formatter={(v) => [`${v}%`, "Mortality"]} />
                <ReferenceLine y={15} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "15% benchmark", fontSize: 11, fill: "#dc2626", position: "insideTopRight" }} />
                <Line dataKey="rate" stroke="#0f766e" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Today's process compliance">
          {[["Temperatures recorded", tempsDone], ["Doctor visits done", visitsDone]].map(([label, n]) => (
            <div key={label as string} className="mb-4">
              <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="tabular-nums">{n}/{active.length}</span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${active.length ? ((n as number) / active.length) * 100 : 0}%` }} /></div>
            </div>
          ))}
          <p className="text-xs text-slate-500">Missed readings and visits are logged when the day is closed.</p>
        </Card>
      </div>
      <Card title="Activity log" className="mt-5">
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
          {events.slice(0, 50).map((e, i) => (
            <li key={i} className="flex items-start gap-3 py-2">
              <span className="w-14 shrink-0 text-xs text-slate-500">{fmtDay(e.day)}</span>
              <Badge tone={e.tone === "bad" ? "red" : e.tone === "warn" ? "amber" : e.tone === "good" ? "green" : "gray"}>{e.actor}</Badge>
              <span className="text-slate-700">{e.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
