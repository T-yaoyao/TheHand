import { z } from 'zod';
export declare const FieldSpecSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    type: string;
}, {
    name: string;
    type: string;
}>;
export declare const StructuredRequirementSchema: z.ZodObject<{
    type: z.ZodString;
    entity: z.ZodString;
    fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: string;
    }, {
        name: string;
        type: string;
    }>, "many">>;
    scope: z.ZodEnum<["frontend", "backend", "fullstack"]>;
    description: z.ZodString;
    isDefaulted: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    description: string;
    type: string;
    entity: string;
    scope: "frontend" | "backend" | "fullstack";
    fields?: {
        name: string;
        type: string;
    }[] | undefined;
    isDefaulted?: boolean | undefined;
}, {
    description: string;
    type: string;
    entity: string;
    scope: "frontend" | "backend" | "fullstack";
    fields?: {
        name: string;
        type: string;
    }[] | undefined;
    isDefaulted?: boolean | undefined;
}>;
export declare const ClarificationOutputSchema: z.ZodObject<{
    needsMoreInfo: z.ZodBoolean;
    questions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    requirement: z.ZodOptional<z.ZodObject<{
        type: z.ZodString;
        entity: z.ZodString;
        fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            type: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            type: string;
        }, {
            name: string;
            type: string;
        }>, "many">>;
        scope: z.ZodEnum<["frontend", "backend", "fullstack"]>;
        description: z.ZodString;
        isDefaulted: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        type: string;
        entity: string;
        scope: "frontend" | "backend" | "fullstack";
        fields?: {
            name: string;
            type: string;
        }[] | undefined;
        isDefaulted?: boolean | undefined;
    }, {
        description: string;
        type: string;
        entity: string;
        scope: "frontend" | "backend" | "fullstack";
        fields?: {
            name: string;
            type: string;
        }[] | undefined;
        isDefaulted?: boolean | undefined;
    }>>;
    round: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    needsMoreInfo: boolean;
    round: number;
    questions?: string[] | undefined;
    requirement?: {
        description: string;
        type: string;
        entity: string;
        scope: "frontend" | "backend" | "fullstack";
        fields?: {
            name: string;
            type: string;
        }[] | undefined;
        isDefaulted?: boolean | undefined;
    } | undefined;
}, {
    needsMoreInfo: boolean;
    round: number;
    questions?: string[] | undefined;
    requirement?: {
        description: string;
        type: string;
        entity: string;
        scope: "frontend" | "backend" | "fullstack";
        fields?: {
            name: string;
            type: string;
        }[] | undefined;
        isDefaulted?: boolean | undefined;
    } | undefined;
}>;
//# sourceMappingURL=clarification-schema.d.ts.map