import { z } from 'zod';
export const ArchitectFileAnalysisSchema = z.object({
    path: z.string().min(1),
    action: z.enum(['create', 'modify', 'delete']),
    detailedChange: z.string().min(1),
    dependencies: z.array(z.string()),
    exports: z.array(z.string()),
    priority: z.number().int(),
});
export const CrossFileRefSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    ref: z.string(),
});
const BatchSchema = z.object({
    files: z.array(z.string().min(1)).min(1),
    reason: z.string(),
});
export const ArchitectOutputSchema = z.object({
    globalContext: z.string(),
    files: z.array(ArchitectFileAnalysisSchema).min(1),
    crossFileRefs: z.array(CrossFileRefSchema),
    batches: z.array(BatchSchema).min(1),
});
//# sourceMappingURL=architect-schema.js.map