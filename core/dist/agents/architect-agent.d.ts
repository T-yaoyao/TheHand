import type { FilePlan, FileInterface, ChangeBatch } from '../types.js';
/**
 * 用正则提取文件的接口信息
 * 只读 imports 等骨架行，不关注实现细节
 */
export declare function extractFileInterfaces(sandboxPath: string, plan: FilePlan[]): Promise<FileInterface[]>;
/**
 * 主入口：基于依赖分析的纯代码分批
 * 零 LLM 消耗，确定性执行，不会失败
 */
export declare function buildBatches(sandboxPath: string, plan: FilePlan[]): Promise<{
    batches: ChangeBatch[];
    fileInterfaces: FileInterface[];
}>;
//# sourceMappingURL=architect-agent.d.ts.map