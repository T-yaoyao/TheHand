import { z } from 'zod';
export declare const CodeFileOutputSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    summary: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
    path: string;
    summary: string;
}, {
    content: string;
    path: string;
    summary: string;
}>;
export declare const CodingOutputSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        content: z.ZodString;
        summary: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        content: string;
        path: string;
        summary: string;
    }, {
        content: string;
        path: string;
        summary: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    files: {
        content: string;
        path: string;
        summary: string;
    }[];
}, {
    files: {
        content: string;
        path: string;
        summary: string;
    }[];
}>;
//# sourceMappingURL=coding-schema.d.ts.map