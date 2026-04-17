import { zodResolver } from '@hookform/resolvers/zod'
import type { FieldValues, Resolver } from 'react-hook-form'

// The monorepo workspace resolves Bun packages slightly differently than the
// legacy single-app repo. Keep the runtime schema unchanged and centralize the
// type bridge here instead of scattering casts across each form.
export function typedZodResolver<TFieldValues extends FieldValues>(
  schema: unknown
): Resolver<TFieldValues> {
  return zodResolver(schema as never) as Resolver<TFieldValues>
}
