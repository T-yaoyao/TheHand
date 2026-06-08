/**
 * Orchestrator 共享辅助函数
 * 从原 orchestrator.ts 中提取的工具函数
 */
import type { FilePlan } from '../types.js';
/**
 * 将 plan 中的新文件映射到已有的相似文件
 * 解决 LLM 创建 ArticlePreview.jsx 而不是修改 ArticlesPreview.jsx 的问题
 */
export declare function resolvePlanToExistingFiles(plan: FilePlan[], sandboxPath: string): Promise<FilePlan[]>;
/**
 * 递归列出目录下的组件文件
 */
export declare function listFilesRecursive(dirPath: string, maxDepth?: number): Promise<string[]>;
/**
 * 扫描现有前端组件目录，生成 hint 字符串
 * 防止 Plan Agent 创建已存在组件的替代品
 * 从 projectContext.structure 读取组件/路由目录，无配置时跳过扫描
 */
export declare function scanExistingComponents(sandboxPath: string, componentDirs?: string[]): Promise<string>;
/**
 * 从构建/测试错误输出中提取涉及的源码文件路径，并读取其内容
 */
export declare function extractAndReadErrorFiles(errorOutput: string, sandboxPath: string): Promise<{
    path: string;
    content: string;
}[]>;
//# sourceMappingURL=helpers.d.ts.map