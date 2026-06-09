import type { OrchestratorEvent, PhaseContext } from '../../types.js'
import { BasePhaseHandler } from '../phase-handler.js'
import { runClarification, expandClarificationQuestions } from '../../agents/clarification-agent.js'
import { validateRequirement, validationErrorsToQuestions } from '../../utils/requirement-validator.js'
import { transition } from '../state-machine.js'
import { Logger } from '../../utils/logger.js'

const log = Logger.for('phase:clarification')

/**
 * 澄清阶段处理器
 * 
 * 职责：
 * - 通过 LLM 与 PM 多轮对话，将模糊需求结构化为 StructuredRequirement
 * - 校验结构化需求的完整性
 * - 支持追问和确认流程
 */
export class ClarificationPhase extends BasePhaseHandler {
  readonly name = 'clarification'

  async *execute(ctx: PhaseContext): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory, llmClient, promptManager, projectContext } = ctx

    yield this.statusChange('clarifying', 'clarification')

    // 使用显式轮次追踪（回退到对话历史推算）
    const recentConvs = await requirementMemory.getRecentConversations(requirement.id, 50)
    const pmReplies = recentConvs.filter(c => c.role === 'pm')
    const currentRound = requirement.clarificationRound ?? (1 + pmReplies.length)

    let pmInput = requirement.pmInput
    if (
      (requirement.status === 'clarifying' || requirement.status === 'waiting-for-pm' || requirement.status === 'needs-confirmation') &&
      pmReplies.length > 0
    ) {
      pmInput = pmReplies.map(c => c.content).join('\n')
    }

    const previousQuestions = recentConvs
      .filter(c => c.role === 'system')
      .map(c => c.content)

    log.info('开始澄清阶段', { round: currentRound, pmRepliesCount: pmReplies.length })

    const clarificationResult = await runClarification(
      llmClient,
      promptManager,
      pmInput,
      projectContext,
      requirement.structuredRequirement,
      currentRound,
      previousQuestions,
      pmReplies.map(c => c.content),
    )

    if (clarificationResult.needsMoreInfo) {
      yield* this.handleNeedsMoreInfo(ctx, clarificationResult, currentRound)
      return
    }

    requirement.structuredRequirement = clarificationResult.requirement
    requirement.clarificationRound = currentRound

    // 第3轮兜底生成的默认需求，进入needs-confirmation状态等待PM确认
    if (requirement.structuredRequirement?.isDefaulted) {
      yield* this.handleDefaultedRequirement(ctx, currentRound)
      return
    }

    // 校验结构化需求的完整性
    const validEntities = projectContext?.models ? Object.keys(projectContext.models) : []
    const validation = validateRequirement(requirement.structuredRequirement!, validEntities)

    if (!validation.valid) {
      yield* this.handleValidationFailure(ctx, validation, currentRound)
      return
    }

    // 澄清完成
    transition(requirement, 'clarified', '澄清完成')
    await requirementMemory.saveRequirement(requirement)

    await requirementMemory.addConversation({
      id: crypto.randomUUID(),
      requirementId: requirement.id,
      role: 'system',
      content: '✅ 澄清完成，开始生成方案…',
      round: currentRound,
      createdAt: new Date(),
    })

    yield this.statusChange('clarified', 'clarification')
    log.info('澄清阶段完成', { type: requirement.structuredRequirement?.type })
  }

  private async *handleNeedsMoreInfo(
    ctx: PhaseContext,
    result: {
      requirement: any
      needsMoreInfo: boolean
      questions: string[] | null
      detectedAmbiguities?: string[] | null
      round: number
    },
    currentRound: number,
  ): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory } = ctx
    const questions = expandClarificationQuestions(
      result.questions ?? [],
      result.detectedAmbiguities,
    )

    for (const q of questions) {
      await requirementMemory.addConversation({
        id: crypto.randomUUID(),
        requirementId: requirement.id,
        role: 'system',
        content: q,
        round: result.round,
        createdAt: new Date(),
      })
    }

    transition(requirement, 'waiting-for-pm', '需要更多信息')
    requirement.structuredRequirement = result.requirement
    await requirementMemory.saveRequirement(requirement)

    yield {
      type: 'waiting-for-pm',
      requirement: { ...requirement, status: 'waiting-for-pm' },
      questions,
    }

    log.info('澄清阶段暂停：等待PM回复', { questionCount: questions.length })
  }

  private async *handleDefaultedRequirement(
    ctx: PhaseContext,
    currentRound: number,
  ): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory } = ctx

    transition(requirement, 'needs-confirmation', '默认值需求需确认')
    await requirementMemory.saveRequirement(requirement)

    await requirementMemory.addConversation({
      id: crypto.randomUUID(),
      requirementId: requirement.id,
      role: 'system',
      content: '⚠️ 信息不足，系统已用合理默认值填充结构化需求，请确认后继续。',
      round: currentRound,
      createdAt: new Date(),
    })

    yield {
      type: 'waiting-for-pm',
      requirement: { ...requirement, status: 'needs-confirmation' },
      questions: ['当前需求信息不完整，系统已自动填充默认值，请确认结构化需求是否正确，确认后继续生成方案。'],
    }
  }

  private async *handleValidationFailure(
    ctx: PhaseContext,
    validation: { valid: boolean; errors: any[]; autoFixable: boolean },
    currentRound: number,
  ): AsyncGenerator<OrchestratorEvent> {
    const { requirement, requirementMemory } = ctx
    const questions = validationErrorsToQuestions(validation.errors)

    log.warn('需求校验未通过', { questions })

    if (validation.autoFixable && currentRound < 3) {
      await requirementMemory.addConversation({
        id: crypto.randomUUID(),
        requirementId: requirement.id,
        role: 'system',
        content: questions.join('\n'),
        round: currentRound + 1,
        createdAt: new Date(),
      })

      transition(requirement, 'clarifying', '校验未通过可自动修复')
      await requirementMemory.saveRequirement(requirement)

      yield {
        type: 'waiting-for-pm',
        requirement: { ...requirement, status: 'clarifying' },
        questions,
      }
      return
    }

    // 不可自动修复或已到轮次上限
    transition(requirement, 'needs-confirmation', '校验未通过且无法自动修复')
    await requirementMemory.saveRequirement(requirement)

    await requirementMemory.addConversation({
      id: crypto.randomUUID(),
      requirementId: requirement.id,
      role: 'system',
      content: `⚠️ 需求校验未通过：\n${questions.join('\n')}\n请确认或补充后继续。`,
      round: currentRound,
      createdAt: new Date(),
    })

    yield {
      type: 'waiting-for-pm',
      requirement: { ...requirement, status: 'needs-confirmation' },
      questions: [...questions, '请确认或补充以上信息后继续。'],
    }
  }
}
