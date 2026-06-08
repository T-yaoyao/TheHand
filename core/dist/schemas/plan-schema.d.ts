import { z } from 'zod';
export declare const FilePlanSchema: z.ZodObject<{
    path: z.ZodString;
    changeDescription: z.ZodString;
    priority: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    path: string;
    changeDescription: string;
    priority?: number | undefined;
}, {
    path: string;
    changeDescription: string;
    priority?: number | undefined;
}>;
export declare const PlanOutputSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        changeDescription: z.ZodString;
        priority: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        changeDescription: string;
        priority?: number | undefined;
    }, {
        path: string;
        changeDescription: string;
        priority?: number | undefined;
    }>, "many">;
    summary: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    files: {
        path: string;
        changeDescription: string;
        priority?: number | undefined;
    }[];
    summary?: string | undefined;
}, {
    files: {
        path: string;
        changeDescription: string;
        priority?: number | undefined;
    }[];
    summary?: string | undefined;
}>;
//# sourceMappingURL=plan-schema.d.ts.map