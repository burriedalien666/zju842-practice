import { validVersion, newer } from './update-files.js';
const bad = text => { throw new Error(text); };
export function requireProgram(requirement, version) {
  if (requirement == null) return; // Legacy r0/r1 packages did not declare it.
  if (!validVersion(requirement)) bad('\u8d44\u6599\u5305\u7a0b\u5e8f\u4f9d\u8d56\u683c\u5f0f\u4e0d\u6b63\u786e');
  if (newer(requirement, version)) bad('\u8bf7\u5148\u66f4\u65b0\u7a0b\u5e8f\uff0c\u518d\u5b89\u88c5\u6b64\u8d44\u6599\u5305');
}
export function validateLibraryTransition(current, next, { expected, version, independentAnswers = false } = {}) {
  requireProgram(next.requiresProgram, version);
  requireProgram(expected?.requiresProgram, version);
  if (next.libraryId != null && next.libraryId !== 'zju842') bad('\u9898\u5e93 libraryId \u4e0d\u5339\u914d');
  const oldRevision = current.libraryRevision || 0;
  const revision = next.libraryRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision < oldRevision)
    bad('\u4e0d\u80fd\u7528\u65e7\u9898\u5e93\u8986\u76d6\u65b0\u7248');
  const standalone = !!expected || next.updateKind === 'library';
  if (standalone && (next.libraryId !== 'zju842' || revision <= oldRevision ||
      (expected && revision !== expected.revision) || Object.keys(next.officialAnswers || {}).length))
    bad('\u9898\u5e93\u5305\u7248\u672c\u4e0d\u5339\u914d\u3001\u5df2\u5b89\u88c5\u6216\u6df7\u5165\u4e86\u7b54\u6848\u66f4\u65b0');
  if (expected && next.requiresProgram && next.requiresProgram !== expected.requiresProgram)
    bad('\u9898\u5e93\u5305\u4e0e\u6e05\u5355\u7684\u7a0b\u5e8f\u4f9d\u8d56\u4e0d\u5339\u914d');
  const byId = new Map(next.questions.map(q => [q.id, q]));
  if (byId.size !== next.questions.length) bad('\u9898\u53f7\u91cd\u590d');
  for (const q of current.questions) {
    const after = byId.get(q.id);
    if (!after) bad('\u65b0\u7248\u7f3a\u5c11\u5df2\u6709\u9898\u53f7\uff0c\u5df2\u505c\u6b62\u66f4\u65b0\u4ee5\u4fdd\u7559\u5b66\u4e60\u8bb0\u5f55');
    if (['sourceKind', 'year', 'number'].some(k => q[k] !== after[k]))
      bad('\u5df2\u6709\u9898\u53f7\u88ab\u590d\u7528\u4e3a\u4e0d\u540c\u8bd5\u5377\u9898\u76ee');
  }
  if (!standalone && independentAnswers && Object.keys(next.officialAnswers || {}).length)
    bad('\u5df2\u5b89\u88c5\u72ec\u7acb\u516c\u5171\u7b54\u6848\uff0c\u8bf7\u7528\u72ec\u7acb\u7b54\u6848\u5305\u66f4\u65b0\uff0c\u907f\u514d\u6df7\u5408\u5305\u7b54\u6848\u88ab\u5ffd\u7565');
  return { standalone };
}
export function validateAnswerTransition(catalog, current, next, { expected, version } = {}) {
  requireProgram(next.requiresProgram, version); requireProgram(expected?.requiresProgram, version);
  if (next.libraryId !== 'zju842') bad('\u7b54\u6848 libraryId \u4e0d\u5339\u914d');
  if (expected && (next.revision !== expected.revision || next.requiresLibraryRevision !== expected.requiresLibraryRevision ||
      (next.requiresProgram && next.requiresProgram !== expected.requiresProgram)))
    bad('\u7b54\u6848\u5305\u7248\u672c\u6216\u4f9d\u8d56\u4e0e\u53d1\u5e03\u4fe1\u606f\u4e0d\u7b26');
  const ids = new Set(catalog.questions.map(q => q.id));
  if (next.requiresLibraryRevision > (catalog.libraryRevision || 0) || Object.keys(next.answers).some(id => !ids.has(id)))
    bad('\u7b54\u6848\u5bf9\u5e94\u7684\u9898\u76ee\u5c1a\u672a\u5b89\u88c5\uff0c\u8bf7\u5148\u66f4\u65b0\u9898\u5e93');
  if (next.revision <= current.revision) bad('\u4e0d\u80fd\u7528\u65e7\u7b54\u6848\u6216\u540c\u7248\u672c\u5305\u8986\u76d6\u5df2\u5b89\u88c5\u516c\u5171\u7b54\u6848');
}
