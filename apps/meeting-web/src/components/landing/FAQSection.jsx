import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

const faqItems = [
  {
    question: "How does Meeting Agent capture meetings?",
    answer:
      "Meeting Agent joins your scheduled calls as a participant, records the audio, and generates a real-time transcript. It works with all major video conferencing platforms without requiring any plugins or extensions on your end.",
  },
  {
    question: "Is my meeting data private and secure?",
    answer:
      "Yes. All transcripts and summaries are encrypted at rest and in transit. Your data is isolated to your workspace, and we never use meeting content to train models. You can delete any meeting record at any time.",
  },
  {
    question: "What happens after a meeting ends?",
    answer:
      "Within minutes of the meeting ending, Meeting Agent generates a structured summary including key decisions, action items with owners, and follow-up questions. These are searchable and linked to the full transcript.",
  },
  {
    question: "Can I search across all past meetings?",
    answer:
      "Absolutely. The searchable team memory lets you find any decision, discussion point, or action item across your entire meeting history. You can search by keyword, speaker, date range, or topic.",
  },
  {
    question: "Does Meeting Agent work with my existing tools?",
    answer:
      "Meeting Agent integrates with popular calendar, project management, and communication tools. Summaries and action items can be pushed to Slack, Notion, Linear, or your preferred workspace automatically.",
  },
  {
    question: "How accurate are the AI-generated summaries?",
    answer:
      "Our transcription accuracy consistently exceeds 98% for clear audio. Summaries are generated using purpose-built models that understand meeting structure, and you can always edit or annotate any summary after generation.",
  },
];

/**
 * FAQ section with shadcn Accordion component.
 * Centered layout with max-width constraint for readability.
 */
export default function FAQSection() {
  return (
    <section
      data-testid="faq-section"
      className="bg-background text-foreground"
    >
      <div className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
        {/* Header */}
        <div className="mb-10 text-center">
          <h2
            className="text-3xl font-bold tracking-tight md:text-4xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Frequently asked questions
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Everything you need to know about Meeting Agent.
          </p>
        </div>

        {/* Accordion */}
        <Accordion data-testid="faq-accordion">
          {faqItems.map(({ question, answer }, index) => (
            <AccordionItem key={index} value={`faq-${index}`}>
              <AccordionTrigger data-testid={`faq-trigger-${index}`}>
                {question}
              </AccordionTrigger>
              <AccordionContent>
                <p>{answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
