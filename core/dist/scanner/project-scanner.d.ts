/**
 * 项目自动扫描器
 * 混合模式：代码扫描（快/免费）+ LLM 分析（智能/有成本）
 *
 * 扫描内容：
 * 1. 路由模式 — 怎么注册路由
 * 2. 组件结构 — 目录命名约定
 * 3. 依赖列表 — 可用的库
 * 4. ORM 模式 — 数据库框架特征
 * 5. 样式模式 — CSS 方案
 * 6. 入口文件 — main/App/router 位置
 * 7. LLM 推导 — 复杂业务约定（导航模式、组件集成方式等）
 */
import type { LLMClient } from '../llm/llm-client.js';
export interface ProjectScanResult {
    /** 自动推导的约束（注入到 prompt） */
    constraints: Record<string, string>;
    /** 检测到的上下文文件 */
    contextFiles: string[];
    /** 检测到的语义标签（JSX 框架标签） */
    semanticTags: string[];
    /** 排除目录列表 */
    excludeDirs: string[];
    /** ORM 特征 */
    ormPatterns: {
        modelField?: string;
    };
    /** 扫描诊断信息 */
    diagnostics: string[];
}
/**
 * 扫描项目代码，自动推导项目约定
 * @param sandboxPath 项目根目录
 * @param llmClient 可选，传入后启用 LLM 深度分析
 */
export declare function scanProject(sandboxPath: string, llmClient?: LLMClient): Promise<ProjectScanResult>;
//# sourceMappingURL=project-scanner.d.ts.map