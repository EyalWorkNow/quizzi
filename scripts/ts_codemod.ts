import { Project, SyntaxKind, CallExpression } from 'ts-morph';
import path from 'path';

const project = new Project({
  tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
});

const sourceFiles = project.getSourceFiles('src/server/**/*.ts');

for (const sourceFile of sourceFiles) {
  let hasChanges = false;
  
  // Find all db.prepare calls
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  const toAwait: CallExpression[] = [];

  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (expression.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    
    // db.prepare(...).get|all|run
    const propAccess = expression.asKind(SyntaxKind.PropertyAccessExpression);
    if (!propAccess) continue;
    
    const methodName = propAccess.getName();
    if (!['get', 'all', 'run'].includes(methodName)) continue;
    
    const innerExpr = propAccess.getExpression();
    if (innerExpr.getKind() !== SyntaxKind.CallExpression) continue;
    
    const innerCall = innerExpr.asKind(SyntaxKind.CallExpression);
    if (!innerCall) continue;
    
    const innerPropAccess = innerCall.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (!innerPropAccess) continue;
    
    if (innerPropAccess.getExpression().getText() === 'db' && innerPropAccess.getName() === 'prepare') {
      toAwait.push(callExpr);
    }
  }

  // Handle db.transaction((...) => { ... })
  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
       const propAccess = expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
       if (propAccess.getExpression().getText() === 'db' && propAccess.getName() === 'transaction') {
         const args = callExpr.getArguments();
         for (const arg of args) {
           if (arg.getKind() === SyntaxKind.ArrowFunction || arg.getKind() === SyntaxKind.FunctionExpression) {
             const func = arg.asKind(SyntaxKind.ArrowFunction) || arg.asKind(SyntaxKind.FunctionExpression);
             if (func && !func.isAsync()) {
               func.setIsAsync(true);
               hasChanges = true;
             }
           }
         }
       }
    }
  }

  for (const callExpr of toAwait) {
    // Enclose callExpr in await if not already
    const parent = callExpr.getParent();
    if (parent && parent.getKind() === SyntaxKind.AwaitExpression) continue;
    
    // Check if it's the property target of another call or access (e.g. .map, .score)
    // If it's `db.prepare().get()?.field`, replacing text is tricky.
    // Replace expression with `(await db.prepare().get())`
    const oldText = callExpr.getText();
    // Use replaceWithText
    try {
        callExpr.replaceWithText(`(await ${oldText})`);
        hasChanges = true;
    } catch {
        // Fallback or ignore for now if structure changed
    }
  }

  // Make parent functions async
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
          break; // only innermost function
        }
        node = node.getParent();
      }
    }
    sourceFile.saveSync();
    console.log(`Refactored ${sourceFile.getFilePath()}`);
  }
}
