import { Project, SyntaxKind, CallExpression, Identifier } from 'ts-morph';
import path from 'path';

const project = new Project({
  tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
});

function runPass() {
  let madeChanges = false;
  const sourceFiles = project.getSourceFiles('src/server/**/*.ts');

  // Collect all async function names in the project
  const asyncFuncNames = new Set<string>();

  for (const sf of sourceFiles) {
    sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).forEach((fn) => {
      if (fn.isAsync() && fn.getName()) asyncFuncNames.add(fn.getName()!);
    });
    sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach((vd) => {
      const init = vd.getInitializer();
      if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
        if ((init.asKind(SyntaxKind.ArrowFunction) || init.asKind(SyntaxKind.FunctionExpression))?.isAsync() && vd.getName()) {
          asyncFuncNames.add(vd.getName()!);
        }
      }
    });
  }

  // Same manual list from before just to be safe, plus any others discovered
  const KNOWN_ASYNC = new Set([
      'getTeacherUserByEmail',
      'createTeacherUser',
      'getOrCreateMaterialProfile',
      'buildGenerationSource',
      'getCachedQuestionGeneration',
      'saveCachedQuestionGeneration',
      'hydratePack',
      'getHydratedPackWithQuestions',
      'listHydratedPacks',
      'syncPackDerivedData',
      'seedDemoDataForTeacher',
      'getSessionPayload',
      'getParticipantsForNickname',
      'getSessionsForIds',
      'getPacksForIds',
      'getMasteryRows',
      'getLogsForParticipantIds',
      'hydrateSessionState',
  ]);

  for (const name of KNOWN_ASYNC) asyncFuncNames.add(name);

  for (const sourceFile of sourceFiles) {
    let fileChanged = false;
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    const toAwait: CallExpression[] = [];

    for (const call of calls) {
      const expr = call.getExpression();
      if (expr.getKind() === SyntaxKind.Identifier) {
        if (asyncFuncNames.has(expr.getText())) {
          const parent = call.getParent();
          if (parent && parent.getKind() !== SyntaxKind.AwaitExpression) {
            toAwait.push(call);
          }
        }
      }
    }

    for (const call of toAwait) {
      try {
        call.replaceWithText(`(await ${call.getText()})`);
        fileChanged = true;
        madeChanges = true;
      } catch {
        // ignore
      }
    }

    if (fileChanged) {
      const awaits = sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression);
      for (const awaitExpr of awaits) {
        let node: any = awaitExpr;
        while (node) {
          if (
            node.getKind() === SyntaxKind.FunctionDeclaration ||
            node.getKind() === SyntaxKind.MethodDeclaration ||
            node.getKind() === SyntaxKind.ArrowFunction ||
            node.getKind() === SyntaxKind.FunctionExpression
          ) {
            if (!node.isAsync()) {
              node.setIsAsync(true);
              fileChanged = true;
              madeChanges = true;
            }
            break;
          }
          node = node.getParent();
        }
      }
      sourceFile.saveSync();
    }
  }
  return madeChanges;
}

let passes = 0;
while (runPass() && passes < 10) {
  passes++;
  console.log(`Completed pass ${passes}`);
}
console.log('Codemod finished.');
