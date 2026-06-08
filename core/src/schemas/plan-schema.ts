import { z } from 'zod'

export const FilePlanSchema = z.object({
  path: z.string().min(1),
  changeDescription: z.string(),
  priority: z.number().int().optional(),
})

export const PlanOutputSchema = z.object({
  files: z.array(FilePlanSchema).min(1),
  summary: z.string().optional(),
})
