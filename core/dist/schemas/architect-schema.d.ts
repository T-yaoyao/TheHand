import { z } from 'zod';
export declare const ArchitectFileAnalysisSchema: z.ZodObject<{
    path: z.ZodString;
    action: z.ZodEnum<["create", "modify", "delete"]>;
    detailedChange: z.ZodString;
    dependencies: z.ZodArray<z.ZodString, "many">;
    exports: z.ZodArray<z.ZodString, "many">;
    priority: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    priority: number;
    path: string;
    action: "create" | "modify" | "delete";
    detailedChange: string;
    dependencies: string[];
    exports: string[];
}, {
    priority: number;
    path: string;
    action: "create" | "modify" | "delete";
    detailedChange: string;
    dependencies: string[];
    exports: string[];
}>;
export declare const CrossFileRefSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    ref: z.ZodString;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string;
    ref: string;
}, {
    from: string;
    to: string;
    ref: string;
}>;
export declare const ArchitectOutputSchema: z.ZodObject<{
    globalContext: z.ZodString;
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        action: z.ZodEnum<["create", "modify", "delete"]>;
        detailedChange: z.ZodString;
        dependencies: z.ZodArray<z.ZodString, "many">;
        exports: z.ZodArray<z.ZodString, "many">;
        priority: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        priority: number;
        path: string;
        action: "create" | "modify" | "delete";
        detailedChange: string;
        dependencies: string[];
        exports: string[];
    }, {
        priority: number;
        path: string;
        action: "create" | "modify" | "delete";
        detailedChange: string;
        dependencies: string[];
        exports: string[];
    }>, "many">;
    crossFileRefs: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        ref: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        from: string;
        to: string;
        ref: string;
    }, {
        from: string;
        to: string;
        ref: string;
    }>, "many">;
    batches: z.ZodArray<z.ZodObject<{
        files: z.ZodArray<z.ZodString, "many">;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        files: string[];
        reason: string;
    }, {
        files: string[];
        reason: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    files: {
        priority: number;
        path: string;
        action: "create" | "modify" | "delete";
        detailedChange: string;
        dependencies: string[];
        exports: string[];
    }[];
    globalContext: string;
    crossFileRefs: {
        from: string;
        to: string;
        ref: string;
    }[];
    batches: {
        files: string[];
        reason: string;
    }[];
}, {
    files: {
        priority: number;
        path: string;
        action: "create" | "modify" | "delete";
        detailedChange: string;
        dependencies: string[];
        exports: string[];
    }[];
    globalContext: string;
    crossFileRefs: {
        from: string;
        to: string;
        ref: string;
    }[];
    batches: {
        files: string[];
        reason: string;
    }[];
}>;
//# sourceMappingURL=architect-schema.d.ts.map