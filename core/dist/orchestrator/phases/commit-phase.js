import { BasePhaseHandler } from '../phase-handler.js';
import { transition } from '../state-machine.js';
import { Logger } from '../../utils/logger.js';
const log = Logger.for('phase:commit');
/**
 * 提交阶段处理器
 *
 * 职责：
 * - 将沙箱中的代码提交到 git
 * - 应用变更到源仓库
 * - 标记需求为 done
 */
export class CommitPhase extends BasePhaseHandler {
    name = 'commit';
    async *execute(ctx) {
        const { requirement, requirementMemory, repoManager, sandboxManager, sandbox } = ctx;
        yield this.progress('committing', 90);
        const reqMarker = `[req:${requirement.id.slice(0, 8)}]`;
        const rawDesc = (requirement.structuredRequirement?.description ?? requirement.pmInput).replace(/[`$"]/g, "'");
        const commitMsg = `${reqMarker} feat: ${rawDesc}`.slice(0, 200);
        // 提交到沙箱 git（精确 stage 计划内文件）
        const plannedFiles = (requirement.plan ?? []).map((f) => f.path).filter(Boolean);
        try {
            await repoManager.commit(commitMsg, plannedFiles.length > 0 ? plannedFiles : undefined);
            yield this.progress('committed to sandbox', 95);
        }
        catch (e) {
            yield this.progress(`commit failed: ${e.message}`, 95);
            transition(requirement, 'failed', '沙箱 commit 失败');
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'failed', requirement, error: `沙箱 commit 失败: ${e.message}`, userMessage: '代码提交失败，可能是沙箱环境的 Git 配置问题。' };
            return;
        }
        // 应用到源仓库
        yield this.progress('applying-to-source', 97);
        let changedFiles = [];
        try {
            const { stdout } = await repoManager.getLastCommitFiles();
            changedFiles = stdout.trim().split('\n').filter(Boolean);
        }
        catch { }
        if (changedFiles.length === 0) {
            changedFiles = (requirement.plan ?? []).map((f) => f.path).filter(Boolean);
        }
        try {
            await sandboxManager.applyToSource(sandbox, changedFiles, commitMsg);
            yield this.progress('applied to source', 98);
        }
        catch (e) {
            yield this.progress(`apply failed: ${e.message}`, 98);
            transition(requirement, 'failed', '应用到源仓库失败');
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'failed', requirement, error: `应用到源仓库失败: ${e.message}`, userMessage: '代码变更未能应用到源仓库。沙箱中的代码仍然保留。' };
            return;
        }
        // 完成
        transition(requirement, 'done', '提交完成');
        await requirementMemory.saveRequirement(requirement);
        yield { type: 'completed', requirement };
        log.info('提交阶段完成', { requirementId: requirement.id });
    }
}
//# sourceMappingURL=commit-phase.js.map