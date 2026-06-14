type PlatformModuleCardProps = Readonly<{
  title: string;
  description: string;
}>;

export function PlatformModuleCard({
  title,
  description,
}: PlatformModuleCardProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </section>
  );
}
