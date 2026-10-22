import type * as TS from 'typescript'
import type { Problem } from './check.ts'

export function scanSource(file: string, text: string, network: readonly string[], ts: typeof TS): Problem[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const problems: Problem[] = []
  const access = (node: TS.Node, object: string, name: string): node is TS.PropertyAccessExpression =>
    ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === object && node.name.text === name

  function initializer(node: TS.Identifier): TS.Expression | null | undefined {
    const named = (name: TS.BindingName): boolean => ts.isIdentifier(name)
      ? name.text === node.text : name.elements.some((entry) => ts.isBindingElement(entry) && named(entry.name))
    for (let scope: TS.Node | undefined = node.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => named(parameter.name))) return null
      if (!ts.isSourceFile(scope) && !ts.isBlock(scope)) continue
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) {
          const declaration = statement.declarationList.declarations.find((entry) => named(entry.name))
          if (declaration) return ts.isIdentifier(declaration.name) && statement.declarationList.flags & ts.NodeFlags.Const
            ? declaration.initializer ?? null : null
        } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === node.text) return null
        else if (ts.isImportDeclaration(statement) && statement.importClause) {
          const { name, namedBindings } = statement.importClause
          if (name?.text === node.text || (namedBindings && (ts.isNamespaceImport(namedBindings)
            ? namedBindings.name.text === node.text : namedBindings.elements.some((entry) => entry.name.text === node.text)))) return null
        }
      }
    }
    return undefined
  }

  function value(node: TS.Expression | undefined, depth = 0): TS.Expression | undefined {
    if (!node || depth > 10) return undefined
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) return value(node.expression, depth + 1)
    if (ts.isIdentifier(node)) return value(initializer(node) ?? undefined, depth + 1)
    return node
  }

  function globalApi(node: TS.Expression, name: string): boolean {
    return (ts.isIdentifier(node) && node.text === name && initializer(node) === undefined)
      || (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
        && ['window', 'self', 'globalThis'].includes(node.expression.text) && initializer(node.expression) === undefined && node.name.text === name)
  }

  function urlText(node: TS.Expression | undefined): string | undefined {
    const resolved = value(node)
    if (!resolved) return undefined
    if (ts.isStringLiteral(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) return resolved.text
    return ts.isTemplateExpression(resolved) ? resolved.head.text : undefined
  }

  function requestUrl(node: TS.Expression | undefined): TS.Expression | undefined {
    const request = value(node)
    if (!request || !ts.isObjectLiteralExpression(request)) return undefined
    return request.properties.flatMap((property) => ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'url'
      ? [property.initializer] : [])[0]
  }

  function checkRequest(node: TS.CallExpression | TS.NewExpression): void {
    let url: TS.Expression | undefined
    let transport: string | undefined
    if (ts.isCallExpression(node) && globalApi(node.expression, 'fetch')) {
      url = node.arguments[0]
      transport = 'fetch'
    } else if (ts.isNewExpression(node) && globalApi(node.expression, 'WebSocket')) {
      url = node.arguments?.[0]
      transport = 'WebSocket'
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression
      const receiver = value(method.expression)
      if (method.name.text === 'open' && receiver && ts.isNewExpression(receiver) && globalApi(receiver.expression, 'XMLHttpRequest')) {
        url = node.arguments[1]
        transport = 'XMLHttpRequest'
      } else if (ts.isPropertyAccessExpression(method.expression) && method.expression.name.text === 'http') {
        if (method.name.text === 'get') url = node.arguments[0]
        else if (method.name.text === 'send') url = requestUrl(node.arguments[0])
      } else if (method.name.text === 'call' && ['http.get', 'http.send'].includes(urlText(node.arguments[0]) ?? '')) {
        url = requestUrl(node.arguments[1])
      }
    }
    const text = urlText(url)
    if (text === undefined) return
    if (transport && /^(?:(?:https?|wss?):)?\/\//i.test(text)) {
      report(url!, 'network', `Direct ${transport} to an external URL does not work in the widget sandbox. Fix: use widget.http.get/send through the gateway; list its origin in widget.json "network" with the "network" permission. WebSocket connections are not supported.`)
    } else if (!transport && /^https?:\/\//i.test(text)) {
      let origin: string | undefined
      try { origin = new URL(text).origin } catch { /* The authority is dynamic or incomplete. */ }
      const resolved = value(url)
      if (resolved && ts.isTemplateExpression(resolved) && !/^https?:\/\/[^/?#]*[/?#]/i.test(text)) return
      if (origin !== undefined && !network.includes(origin)) {
        report(url!, 'network', `URL origin ${origin} is not in widget.json "network". Fix: add "${origin}" to network and "network" to permissions, and call it with widget.http.get/send.`)
      }
    }
  }

  function gpuTest(node: TS.Node, positive = false): boolean {
    if (ts.isParenthesizedExpression(node)) return gpuTest(node.expression, positive)
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      return !positive && gpuTest(node.operand)
    }
    return access(node, 'navigator', 'gpu') || (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.InKeyword
      && ts.isStringLiteral(node.left) && node.left.text === 'gpu'
      && ts.isIdentifier(node.right) && node.right.text === 'navigator')
  }

  function positiveGpuTest(node: TS.Node): boolean {
    if (ts.isParenthesizedExpression(node)) return positiveGpuTest(node.expression)
    return gpuTest(node, true) || (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && (positiveGpuTest(node.left) || positiveGpuTest(node.right)))
  }

  function guardedGpu(node: TS.PropertyAccessExpression): boolean {
    let test: TS.Node = node
    while (ts.isParenthesizedExpression(test.parent)
      || (ts.isPrefixUnaryExpression(test.parent) && test.parent.operator === ts.SyntaxKind.ExclamationToken)) {
      test = test.parent
    }
    const parent = test.parent
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent) || ts.isCallExpression(parent))
      && parent.expression === test && parent.questionDotToken) return true
    if ((ts.isIfStatement(parent) && parent.expression === test)
      || (ts.isConditionalExpression(parent) && parent.condition === test)
      || (ts.isBinaryExpression(parent) && ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)
        || (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && parent.left === test)))) return true
    for (let child: TS.Node = node, ancestor = node.parent; ancestor; child = ancestor, ancestor = ancestor.parent) {
      if (ts.isIfStatement(ancestor) && child === ancestor.thenStatement && positiveGpuTest(ancestor.expression)) return true
      if (ts.isConditionalExpression(ancestor) && child === ancestor.whenTrue && positiveGpuTest(ancestor.condition)) return true
      if (ts.isBinaryExpression(ancestor) && ancestor.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        && child === ancestor.right && positiveGpuTest(ancestor.left)) return true
    }
    return false
  }

  function valueUse(node: TS.Identifier): boolean {
    const parent = node.parent
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      return ts.isIdentifier(parent.expression) && ['window', 'globalThis', 'self'].includes(parent.expression.text)
    }
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false
    if (ts.isBindingElement(parent) && parent.propertyName === node) return false
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false
    if ('name' in parent && parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return false
    for (let ancestor: TS.Node | undefined = parent; ancestor; ancestor = ancestor.parent) {
      if (ts.isTypeNode(ancestor)) return false
    }
    return true
  }

  function report(node: TS.Node, rule: Problem['rule'], message: string): void {
    problems.push({ rule, file: file.replaceAll('\\', '/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message })
  }

  function visit(node: TS.Node): void {
    if (ts.isIdentifier(node) && valueUse(node)) {
      if (['localStorage', 'sessionStorage', 'indexedDB'].includes(node.text)) {
        report(node, 'sandbox-api', `"${node.text}" does not work in the widget sandbox (no storage). Fix: use widget.state.get/set.`)
      } else if (node.text === 'Notification') {
        report(node, 'sandbox-api', 'Web Notifications do not work in the widget sandbox. Fix: use widget.notify({ title, body }).')
      } else if (node.text === 'requestIdleCallback') {
        report(node, 'sandbox-api', '"requestIdleCallback" is not available in every dashboard engine. Fix: use setTimeout or requestAnimationFrame.')
      }
    }
    if (access(node, 'document', 'cookie')) {
      report(node, 'sandbox-api', '"document.cookie" does not work in the widget sandbox. Fix: use widget.state.get/set.')
    } else if (access(node, 'scheduler', 'postTask')) {
      report(node, 'sandbox-api', '"scheduler.postTask" is not available in every dashboard engine. Fix: use setTimeout or requestAnimationFrame.')
    } else if (access(node, 'navigator', 'gpu') && !guardedGpu(node)) {
      report(node, 'sandbox-api', '"navigator.gpu" (WebGPU) is not in the runtime baseline. Fix: wrap the use in if (\'gpu\' in navigator) { … } and fall back to WebGL 2.')
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) checkRequest(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return problems
}
