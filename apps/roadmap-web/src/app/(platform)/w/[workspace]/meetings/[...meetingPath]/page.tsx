import { WorkspaceMeetingSurface } from "@/components/meetings/workspace-meeting-surface";

export const dynamic = "force-dynamic";

type WorkspaceMeetingPathPageProps = Readonly<{
  params: Promise<{
    workspace: string;
    meetingPath?: string[];
  }>;
}>;

export default async function WorkspaceMeetingPathPage({
  params,
}: WorkspaceMeetingPathPageProps) {
  const { workspace, meetingPath = [] } = await params;
  const target = resolveWorkspaceMeetingTarget(meetingPath);
  const workspaceLabel = formatPathSegment(workspace);

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold text-slate-950">{target.title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {target.description}
        </p>
      </section>
      <WorkspaceMeetingSurface
        workspaceName={`${workspaceLabel} meetings`}
        recentMeetingTitle={target.recentMeetingTitle}
      />
    </div>
  );
}

function resolveWorkspaceMeetingTarget(meetingPath: readonly string[]) {
  const [targetSegment] = meetingPath;

  if (targetSegment === "new") {
    return {
      title: "Create meeting",
      description: "Start a new meeting inside this workspace.",
      recentMeetingTitle: "New meeting draft",
    };
  }

  if (targetSegment) {
    const meetingLabel = formatPathSegment(targetSegment);

    return {
      title: "Selected meeting",
      description: `Opening ${meetingLabel} inside this workspace.`,
      recentMeetingTitle: meetingLabel,
    };
  }

  return {
    title: "Meeting module",
    description:
      "Shell-hosted meeting entry using the shared meeting presentation surface.",
    recentMeetingTitle: "Product Suite planning review",
  };
}

function formatPathSegment(segment: string): string {
  const decoded = decodePathSegment(segment);
  const formatted = decoded.replace(/[-_]+/g, " ").trim();

  return formatted.length > 0 ? formatted : segment;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
