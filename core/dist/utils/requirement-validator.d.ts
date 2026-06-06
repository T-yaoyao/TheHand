import type { StructuredRequirement, ValidationResult, ValidationError } from '../types.js';
/**
 * 校验结构化需求的完整性
 * 在澄清完成后、进入 Plan 阶段之前调用
 */
export declare function validateRequirement(req: StructuredRequirement, validEntities: string[]): ValidationResult;
/**
 * 将校验错误转化为 PM 可读的追问消息
 */
export declare function validationErrorsToQuestions(errors: ValidationError[]): string[];
//# sourceMappingURL=requirement-validator.d.ts.map