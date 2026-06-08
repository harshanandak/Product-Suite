import { WorkspaceMeetingSurface } from "@/components/meetings/workspace-meeting-surface";

export default function MeetingsPage() {
  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-950">Meeting module</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Shell-hosted meeting entry using the shared meeting presentation surface.
        </p>
      </section>
      <WorkspaceMeetingSurface
        workspaceName="Meeting module"
        recentMeetingTitle="Product Suite planning review"
      />
    </div>
  );
}
