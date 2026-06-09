import { z } from 'zod'

export const FieldSpecSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
})

export const StructuredRequirementSchema = z.object({
  type: z.string().min(1),
  entity: z.string().min(1),
  fields: z.array(FieldSpecSchema).optional(),
  scope: z.enum(['frontend', 'backend', 'fullstack']),
  description: z.string().min(1),
  isDefaulted: z.boolean().optional(),
})

export const ClarificationOutputSchema = z.object({
  needsMoreInfo: z.boolean(),
  questions: z.array(z.string()).optional(),
  detectedAmbiguities: z.array(z.string()).optional(),
  requirement: StructuredRequirementSchema.optional(),
  round: z.number().int().min(1).max(3),
})
