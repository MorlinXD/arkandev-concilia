export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${big ? "h-10 w-10" : "h-8 w-8"} grid place-items-center rounded-xl bg-brand shadow-lg shadow-brand/30`}>
        <svg viewBox="0 0 24 24" className={big ? "h-6 w-6" : "h-5 w-5"} fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20 L12 4 L20 20" />
          <path d="M8.5 14.5 L11 17 L16 11.5" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className={`${big ? "text-xl" : "text-base"} font-semibold tracking-tight`}>
          Concilia
        </div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
          by Arkan<span className="text-brand-soft">dev</span>
        </div>
      </div>
    </div>
  );
}
