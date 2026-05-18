'use client';

import { MeetingSummaryBlock } from '@product-suite/ui-meeting';

interface WorkspaceMeetingSurfaceProps {
  workspaceName: string;
  recentMeetingTitle?: string;
}

export function WorkspaceMeetingSurface({
  workspaceName,
  recentMeetingTitle = 'Workspace planning sync',
}: WorkspaceMeetingSurfaceProps) {
  return (
    <section className="overflow-hidden rounded-xl border bg-slate-950 text-white">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="text-xs font-medium uppercase text-white/55">Shared meeting block</div>
        <h2 className="mt-1 text-lg font-semibold">{workspaceName}</h2>
      </div>
      <MeetingSummaryBlock
        meeting={{ title: recentMeetingTitle }}
        elapsedSeconds={0}
        summaryState={{
          meetingState: {
            current_topic: 'Planning intake',
            current_goal: 'Turn meeting notes into roadmap-ready decisions.',
            summary_bullets: [
              'Capture decisions beside roadmap context.',
              'Reuse meeting summaries without copying meeting-web UI.',
            ],
          },
          recentLines: [
            {
              id: 'roadmap-line-1',
              speaker_label: 'PM',
              text: 'We should connect planning notes to the next work-board pass.',
            },
          ],
          sections: [
            {
              key: 'decisions',
              items: [
                {
                  id: 'roadmap-decision-1',
                  text: 'Use the shared meeting block for roadmap meeting previews.',
                  review_status: 'promoted',
                  confidence: 0.91,
                },
              ],
            },
            {
              key: 'actionItems',
              items: [{ id: 'roadmap-action-1', text: 'Attach follow-up work items after review.' }],
            },
            {
              key: 'openQuestions',
              items: [{ id: 'roadmap-question-1', text: 'Which meetings should sync into workspace memory?' }],
            },
            {
              key: 'chapters',
              items: [
                {
                  id: 'roadmap-chapter-1',
                  title: 'Planning context',
                  summary_text: 'Meeting notes are displayed as a reusable planning surface.',
                  boundary_source: 'fixed_window',
                  window_label: 'Preview',
                },
              ],
            },
          ],
        }}
      />
    </section>
  );
}
