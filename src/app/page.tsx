import Link from "next/link";
import { ClipboardList, LayoutDashboard, Stethoscope, Thermometer } from "lucide-react";

const ROLES = [
  { href: "/nurse", icon: Thermometer, title: "Nurse", text: "See who still needs today's temperature and record it. Duplicates are blocked." },
  { href: "/doctor", icon: Stethoscope, title: "Doctor", text: "Visit only patients whose temperature is in. Approve discharge after 3 fever-free days." },
  { href: "/admin", icon: ClipboardList, title: "Admin", text: "Confirm approved discharges, free rooms, admit new patients (max 74)." },
  { href: "/dashboard", icon: LayoutDashboard, title: "Head Doctor", text: "Track mortality vs the 15% benchmark and daily process compliance." },
];

const FLOW = ["Admin admits patient to a free room", "Nurse records one temperature per day", "Doctor visits once the reading is in", "3 consecutive fever-free days → eligible", "Doctor approves discharge (or records death)", "Admin confirms discharge → room freed", "Head doctor tracks outcomes vs 85% benchmark"];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold text-slate-900">QuaranTrack</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        Temperature tracking and administration for a 74-bed quarantine &amp; treatment facility. Pick a role to start. This prototype has no login: switch roles from the top bar.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {ROLES.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-400 hover:shadow">
            <Icon className="h-6 w-6 text-teal-700" />
            <div className="mt-3 font-semibold text-slate-900 group-hover:text-teal-800">{title} →</div>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </Link>
        ))}
      </div>
      <h2 className="mt-10 font-semibold text-slate-900">Daily workflow</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW.map((s, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700"><span className="mr-2 font-mono text-teal-700">{i + 1}</span>{s}</li>
        ))}
      </ol>
      <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <b>Demo tips:</b> data is pre-seeded and saved in your browser. Use <b>End day</b> in the top bar to simulate the next day (missed readings are logged), and the reset icon to restore demo data.
      </div>
    </div>
  );
}
