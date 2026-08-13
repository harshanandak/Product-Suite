export function migrationStatements(file: string): string[] {
  return file
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}
