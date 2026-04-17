import { Toaster } from "sonner";

export function PublicLayout({ children, accent = "dark" }) {
  const shellClass =
    accent === "dark"
      ? "min-h-screen bg-[#050A30] text-white"
      : "min-h-screen bg-[#F4F0EA] text-[#0A0A0A]";

  return (
    <div className={shellClass}>
      <Toaster position="top-right" richColors />
      {children}
    </div>
  );
}
