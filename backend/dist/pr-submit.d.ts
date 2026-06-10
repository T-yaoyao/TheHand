/**
 * 将当前仓库的已提交变更推送到 origin，并对 main 发起 PR。
 * 认证：优先 `GITHUB_TOKEN`（根目录 .env）；否则依赖 `gh auth login` + `gh auth setup-git`。
 */
export declare function pushBranchAndCreatePrToMain(options: {
    cwd: string;
    requirementId: string;
    pmInput: string;
}): string;
//# sourceMappingURL=pr-submit.d.ts.map