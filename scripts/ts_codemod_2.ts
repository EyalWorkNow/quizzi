import { Project, SyntaxKind, CallExpression } from 'ts-morph';
import path from 'path';

const project = new Project({
  tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
});

const ASYNC_FUNCTIONS = new Set([
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
]);

const sourceFiles = project.getSourceFiles('src/server/**/*.ts');

for (const sourceFile of sourceFiles) {
  let hasChanges = false;
  
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  const toAwait: CallExpression[] = [];

  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (expression.getKind() === SyntaxKind.Identifier) {
      if (ASYNC_FUNCTIONS.has(expression.getText())) {
        toAwait.push(callExpr);
      }
    }
  }

  for (const callExpr of toAwait) {
    const parent = callExpr.getParent();
    if (parent && parent.getKind() === SyntaxKind.AwaitExpression) continue;
    
    try {
        callExpr.replaceWithText(`(await ${callExpr.getText()})`);
        hasChanges = true;
    } catch {
        // ignore
    }
  }

  if (hasChanges) {
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
            hasChanges = true;
          }
          break;
        }
        node = node.getParent();
      }
    }
    sourceFile.saveSync();
    console.log(`Refactored ${sourceFile.getFilePath()}`);
  }
}
