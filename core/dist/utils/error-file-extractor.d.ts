/**
 * 从构建/测试错误输出中提取涉及的源码文件路径，并读取其内容
 * 共享模块：orchestrator.ts 和 testing-phase.ts 共用
 *
 * 只提取项目源码文件，排除 node_modules、工具内部文件、堆栈帧
 * 返回 {path, content}[] 供 coding agent 作为上下文参考
 */
export declare function extractAndReadErrorFiles(errorOutput: string, sandboxPath: string): Promise<{
    path: string;
    content: string;
}[]>;
/**
 * 从错误输出中提取项目源码文件路径（纯解析，不读文件）
 */
export declare function extractErrorFilePaths(errorOutput: string): Set<string>;
//# sourceMappingURL=error-file-extractor.d.ts.map