export default function StatCard({ label, value, accent = "from-blue-700 to-blue-500" }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-3 bg-gradient-to-r ${accent} bg-clip-text text-3xl font-bold text-transparent`}>
        {value}
      </p>
    </div>
  );
}
