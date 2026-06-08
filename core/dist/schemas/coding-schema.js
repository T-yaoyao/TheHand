import { z } from 'zod';
export const CodeFileOutputSchema = z.object({
    path: z.string().min(1),
    content: z.string(),
    summary: z.string(),
});
export const CodingOutputSchema = z.object({
    files: z.array(CodeFileOutputSchema).min(1),
});
//# sourceMappingURL=coding-schema.js.map