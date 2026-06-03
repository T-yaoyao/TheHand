import { readFile, stat } from 'fs/promises';
import { join } from 'path';
/**
 * 增量Diff安全检查器
 * 检测无关变更，防止AI意外修改未计划的内容
 */
export class DiffSafetyChecker {
    sandboxRoot;
    constructor(sandboxRoot) {
        this.sandboxRoot = sandboxRoot;
    }
    async check(originalFiles, plan) {
        const unexpectedFiles = [];
        const unrelatedChanges = [];
        const warnings = [];
        const plannedPaths = new Set(plan.map(p => p.path));
        for (const [filePath, originalContent] of originalFiles.entries()) {
            const fullPath = join(this.sandboxRoot, filePath);
            try {
                await stat(fullPath);
                const newContent = await readFile(fullPath, 'utf-8');
                if (!plannedPaths.has(filePath)) {
                    unexpectedFiles.push(filePath);
                    warnings.push(`检测到未计划修改的文件: ${filePath}`);
                    continue;
                }
                const unrelatedLines = this.findUnrelatedChanges(originalContent, newContent);
                if (unrelatedLines.length > 0) {
                    unrelatedChanges.push({
                        path: filePath,
                        lines: unrelatedLines,
                        description: `文件 ${filePath} 中检测到 ${unrelatedLines.length} 行非预期变更`,
                    });
                    warnings.push(`文件 ${filePath} 存在非预期变更，行号: ${unrelatedLines.join(', ')}`);
                }
            }
            catch (e) {
                // 文件不存在（可能是新创建或被删除）
                if (!plannedPaths.has(filePath)) {
                    unexpectedFiles.push(filePath);
                }
            }
        }
        const isSafe = unexpectedFiles.length === 0 && unrelatedChanges.length === 0;
        return {
            hasUnexpectedChanges: unexpectedFiles.length > 0 || unrelatedChanges.length > 0,
            unexpectedFiles,
            unrelatedChanges,
            warnings,
            isSafe,
        };
    }
    findUnrelatedChanges(original, modified) {
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');
        const unrelatedLines = [];
        // 简单的差异检测：找出新增/修改的行
        // 实际项目中可以集成真正的diff算法
        for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
            const origLine = originalLines[i] ?? '';
            const modLine = modifiedLines[i] ?? '';
            if (origLine.trim() !== modLine.trim()) {
                // 跳过空行、仅空格的行、注释行的差异
                if (this.isTrivialChange(origLine, modLine)) {
                    continue;
                }
                unrelatedLines.push(i + 1); // 行号从1开始
            }
        }
        return unrelatedLines;
    }
    isTrivialChange(orig, mod) {
        // 空行变化
        if (orig.trim() === '' && mod.trim() === '') {
            return true;
        }
        // 仅空格变化
        if (orig.trim() === mod.trim() && orig.length !== mod.length) {
            return true;
        }
        // 注释行变化
        const isComment = (line) => line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*');
        if (isComment(orig) && isComment(mod)) {
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=diff-safety-checker.js.map