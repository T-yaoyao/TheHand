import type { StructuredRequirement, ValidationResult, ValidationError } from '../types.js'

// 需要 fields 的需求类型（与 CLARIFICATION_TOOLS enum 和 prompt 保持同步）
const FIELDS_REQUIRED: string[] = ['add_field', 'delete_field']

// 合法的 type 枚举（与 clarification-agent.ts 中 CLARIFICATION_TOOLS 的 enum 保持同步）
const VALID_TYPES: string[] = [
  'add_display', 'add_page', 'add_field', 'modify_api', 'add_feature', 'delete_page', 'delete_field',
]

// 合法的 scope 枚举
const VALID_SCOPES: string[] = ['frontend', 'backend', 'fullstack']

/**
 * 校验结构化需求的完整性
 * 在澄清完成后、进入 Plan 阶段之前调用
 */
export function validateRequirement(
  req: StructuredRequirement,
  validEntities: string[],
): ValidationResult {
  const errors: ValidationError[] = []

  // 1. type 校验
  if (!req.type || !VALID_TYPES.includes(req.type)) {
    errors.push({
      field: 'type',
      message: `需求类型 "${req.type ?? ''}" 不合法，请选择：${VALID_TYPES.join('、')}`,
      severity: 'error',
    })
  }

  // 2. entity 校验
  if (!req.entity || req.entity === 'unknown') {
    errors.push({
      field: 'entity',
      message: validEntities.length > 0
        ? `请说明涉及哪个数据模型，可选：${validEntities.join('、')}`
        : '请说明涉及哪个数据模型',
      severity: 'error',
    })
  } else if (validEntities.length > 0 && !validEntities.includes(req.entity)) {
    errors.push({
      field: 'entity',
      message: `数据模型 "${req.entity}" 不存在，可选：${validEntities.join('、')}`,
      severity: 'error',
    })
  }

  // 3. fields 校验（仅对需要 fields 的类型）
  if (req.type && FIELDS_REQUIRED.includes(req.type)) {
    if (!req.fields || req.fields.length === 0) {
      errors.push({
        field: 'fields',
        message: `${req.type} 类型需要指定具体字段（名称和类型），请补充要${req.type === 'add_field' ? '新增' : req.type === 'delete_field' ? '删除' : '修改'}的字段`,
        severity: 'error',
      })
    } else {
      for (const field of req.fields) {
        if (!field.name || field.name.trim() === '') {
          errors.push({
            field: 'fields.name',
            message: '存在未命名的字段，请补充字段名称',
            severity: 'error',
          })
        }
        if (!field.type || field.type.trim() === '') {
          const fieldName = field.name && field.name.trim() !== '' ? field.name : '未知字段'
          errors.push({
            field: 'fields.type',
            message: `字段 "${fieldName}" 缺少类型定义，请补充字段类型（如 STRING、INTEGER、BOOLEAN 等）`,
            severity: 'error',
          })
        }
      }
    }
  }

  // 4. scope 校验
  if (!req.scope || req.scope.trim() === '') {
    errors.push({
      field: 'scope',
      message: '请说明影响范围：frontend（前端）、backend（后端）或 fullstack（全栈）',
      severity: 'error',
    })
  } else if (!VALID_SCOPES.includes(req.scope)) {
    errors.push({
      field: 'scope',
      message: `scope 值 "${req.scope}" 不合法，应为 frontend、backend 或 fullstack`,
      severity: 'error',
    })
  }

  // 5. description 校验
  if (!req.description || req.description.trim() === '') {
    errors.push({
      field: 'description',
      message: '请补充需求描述',
      severity: 'error',
    })
  }

  // autoFixable 只检查 error 级别，忽略 warning
  const fixableFields = ['entity', 'fields', 'fields.name', 'fields.type', 'scope', 'description']
  const errorOnly = errors.filter(e => e.severity === 'error')

  return {
    valid: errorOnly.length === 0,
    errors,
    autoFixable: errorOnly.length > 0 && errorOnly.every(e => fixableFields.includes(e.field)),
  }
}

/**
 * 将校验错误转化为 PM 可读的追问消息
 */
export function validationErrorsToQuestions(errors: ValidationError[]): string[] {
  return errors
    .filter(e => e.severity === 'error')
    .map(e => e.message)
}
