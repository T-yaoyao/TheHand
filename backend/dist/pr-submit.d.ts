/**
 * 将当前仓库的已提交变更推送到 origin，并对 main 发起 PR（需已安装 gh 且已认证）。
 */
export declare function pushBranchAndCreatePrToMain(options: {
    cwd: string;
    requirementId: string;
    pmInput: string;
}): string;
//# sourceMappingURL=pr-submit.d.ts.map