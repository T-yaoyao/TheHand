/**
 * 提交阶段
 * Git commit + 应用到源仓库
 */
import { createLogger } from '../../utils/logger.js';
const log = createLogger('phase:commit');
export class CommitPhase {
    name = 'commit';
    async *run(ctx) {
        const { requirement, requirementMemory, repoManager, sandboxManager, sandbox } = ctx;
        yield { type: 'executing', phase: 'committing', progress: 90 };
        const reqMarker = `[req:${requirement.id.slice(0, 8)}]`;
        const rawDesc = (requirement.structuredRequirement?.description ?? requirement.pmInput).replace(/[`$"]/g, "'");
        const commitMsg = `${reqMarker} feat: ${rawDesc}`.slice(0, 200);
        try {
            await repoManager.commit(commitMsg);
            yield { type: 'executing', phase: 'committed to sandbox', progress: 95 };
        }
        catch (e) {
            yield { type: 'executing', phase: `commit failed: ${e.message}`, progress: 95 };
            requirement.status = 'failed';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'failed', requirement, error: `沙箱 commit 失败: ${e.message}`, userMessage: '代码提交失败。' };
            return;
        }
        // 应用到源仓库
        yield { type: 'executing', phase: 'applying-to-source', progress: 97 };
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
            yield { type: 'executing', phase: 'applied to source', progress: 98 };
        }
        catch (e) {
            yield { type: 'executing', phase: `apply failed: ${e.message}`, progress: 98 };
            requirement.status = 'failed';
            await requirementMemory.saveRequirement(requirement);
            yield { type: 'failed', requirement, error: `应用到源仓库失败: ${e.message}`, userMessage: '代码变更未能应用到源仓库。' };
            return;
        }
        requirement.status = 'done';
        await requirementMemory.saveRequirement(requirement);
        yield { type: 'completed', requirement };
    }
}
//# sourceMappingURL=commit-phase.js.map