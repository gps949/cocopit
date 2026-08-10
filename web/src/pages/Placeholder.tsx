export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{phase}</span>
      </div>
      <p className="mt-4 max-w-md text-sm text-muted">
        此模块尚未交付,将在 {phase} 上线。索引层已就绪,数据在后台持续更新。
      </p>
    </div>
  );
}
