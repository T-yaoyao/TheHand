function ts() {
    return new Date().toISOString().slice(11, 19);
}
export const log = {
    info(...args) {
        console.log(`[${ts()}]`, ...args);
    },
    warn(...args) {
        console.warn(`[${ts()}]`, ...args);
    },
    error(...args) {
        console.error(`[${ts()}]`, ...args);
    },
};
//# sourceMappingURL=logger.js.map