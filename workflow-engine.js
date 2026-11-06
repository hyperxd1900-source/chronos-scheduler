export const VARIABLE_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'date']

export function createWorkflowNode(type, x = 420, y = 260) {
  const id = crypto.randomUUID()
  const variable = (name, description = '') => ({
    id: crypto.randomUUID(),
    name,
    description,
    type: 'string',
    required: true,
    defaultValue: null,
  })

  if (type === 'input') {
    return { id, type, name: 'Input', x, y, outputs: [variable('value', 'A value to start the workflow.') ] }
  }
  if (type === 'process') {
    return {
      id, type, name: 'Process', x, y, description: '',
      expression: 'value',
      inputs: [variable('value', 'Value received from the previous step.')],
      outputs: [variable('result', 'The transformed value.')],
    }
  }
  if (type === 'output') {
    return { id, type, name: 'Output', x, y, inputs: [variable('result', 'The final workflow result.')] }
  }
  throw new Error(`Unknown node type: ${type}`)
}

export function validateGraph(graph) {
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('This file is not a supported workflow graph.')
  }
  const nodeIds = new Set()
  const variableIds = new Map()
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || nodeIds.has(node.id) || !['input', 'process', 'output'].includes(node.type)) {
      throw new Error('Workflow contains an invalid or duplicate node.')
    }
    nodeIds.add(node.id)
    if (typeof node.name !== 'string' || !node.name.trim() || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new Error(`Node ${node.id} has invalid details.`)
    }
    const hasInputArray = Array.isArray(node.inputs)
    const hasOutputArray = Array.isArray(node.outputs)
    if ((node.type === 'input' && (!hasOutputArray || hasInputArray))
      || (node.type === 'process' && (!hasInputArray || !hasOutputArray))
      || (node.type === 'output' && (!hasInputArray || hasOutputArray))) {
      throw new Error(`Node "${node.name}" has an invalid variable configuration.`)
    }
    if (node.type === 'process'
      && ((node.description !== undefined && typeof node.description !== 'string')
        || (node.expression !== undefined && typeof node.expression !== 'string'))) {
      throw new Error(`Node "${node.name}" has invalid process settings.`)
    }
    const variables = [...(node.inputs || []), ...(node.outputs || [])]
    const names = new Set()
    const ids = new Set()
    for (const variable of variables) {
      if (!variable || typeof variable.id !== 'string' || ids.has(variable.id) || variableIds.has(variable.id)
        || typeof variable.name !== 'string' || !variable.name.trim()
        || names.has(variable.name.trim())
        || !VARIABLE_TYPES.includes(variable.type)
        || typeof variable.required !== 'boolean'
        || (variable.description !== undefined && typeof variable.description !== 'string')
        || (variable.expression !== undefined && typeof variable.expression !== 'string')) {
        throw new Error(`Node "${node.name}" contains an invalid or duplicate variable.`)
      }
      names.add(variable.name.trim())
      ids.add(variable.id)
      variableIds.set(variable.id, { node, variable })
    }
  }
  const edgeIds = new Set()
  const targetPorts = new Set()
  for (const edge of graph.edges) {
    const source = variableIds.get(edge?.sourceVariableId)
    const target = variableIds.get(edge?.targetVariableId)
    if (!edge || typeof edge.id !== 'string' || edgeIds.has(edge.id)
      || !source || !target || source.node.id !== edge.source || target.node.id !== edge.target
      || !source.node.outputs?.includes(source.variable)
      || !target.node.inputs?.includes(target.variable)
      || edge.source === edge.target
      || source.variable.type !== target.variable.type) {
      throw new Error('Workflow contains an invalid connection. Check its nodes and variable types.')
    }
    const targetPort = `${edge.target}:${edge.targetVariableId}`
    if (targetPorts.has(targetPort)) throw new Error('A variable can only have one incoming connection.')
    targetPorts.add(targetPort)
    edgeIds.add(edge.id)
  }
  return graph
}

export function topologicalSort(graph) {
  validateGraph(graph)
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]))
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges) {
    incoming.set(edge.target, incoming.get(edge.target) + 1)
    outgoing.get(edge.source).push(edge.target)
  }
  const ready = graph.nodes.filter((node) => incoming.get(node.id) === 0)
  const sorted = []
  while (ready.length) {
    ready.sort((a, b) => order.get(a.id) - order.get(b.id))
    const node = ready.shift()
    sorted.push(node)
    for (const target of outgoing.get(node.id)) {
      incoming.set(target, incoming.get(target) - 1)
      if (incoming.get(target) === 0) ready.push(graph.nodes.find((item) => item.id === target))
    }
  }
  if (sorted.length !== graph.nodes.length) {
    const state = new Map()
    const stack = []
    let cycleIds = []
    function findCycle(startId) {
      state.set(startId, 1)
      stack.push({ id: startId, next: 0 })
      while (stack.length) {
        const current = stack[stack.length - 1]
        const targets = outgoing.get(current.id)
        if (current.next === targets.length) {
          state.set(current.id, 2)
          stack.pop()
          continue
        }
        const target = targets[current.next++]
        if (state.get(target) === 1) {
          cycleIds = stack.slice(stack.findIndex((item) => item.id === target)).map((item) => item.id)
          return true
        }
        if (!state.has(target)) {
          state.set(target, 1)
          stack.push({ id: target, next: 0 })
        }
      }
      return false
    }
    for (const node of graph.nodes) {
      if (!state.has(node.id) && findCycle(node.id)) break
    }
    const cycleNodes = cycleIds.map((id) => graph.nodes.find((node) => node.id === id).name)
    throw new Error(`Cycle detected between: ${cycleNodes.join(', ')}.`)
  }
  return sorted
}

function isMissing(value) {
  return value === undefined || value === null || value === ''
}

function matchesType(value, type) {
  if (isMissing(value)) return true
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return typeof value === 'object' && !Array.isArray(value)
  if (type === 'date') return typeof value === 'string' && !Number.isNaN(Date.parse(value))
  return typeof value === type && (type !== 'number' || Number.isFinite(value))
}

function getInputValues(node, graph, values) {
  const resolved = {}
  for (const variable of node.inputs || []) {
    const edge = graph.edges.find((item) => item.target === node.id && item.targetVariableId === variable.id)
    const connectedValue = edge ? values.get(edge.sourceVariableId) : undefined
    const value = isMissing(connectedValue) ? variable.defaultValue : connectedValue
    if (isMissing(value)) {
      if (variable.required) throw new Error(`Required input "${variable.name}" is missing.`)
      continue
    }
    if (!matchesType(value, variable.type)) {
      throw new Error(`Input "${variable.name}" must be a ${variable.type}.`)
    }
    resolved[variable.name] = value
  }
  return resolved
}

function tokenize(expression) {
  const tokens = []
  let rest = expression.trim()
  while (rest) {
    const whitespace = rest.match(/^\s+/)
    if (whitespace) {
      rest = rest.slice(whitespace[0].length)
      continue
    }
    const token = rest.match(/^(?:("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)|(===|!==|==|!=|<=|>=|[()+\-*/%<>]))/)
    if (!token) throw new Error(`Unsupported expression near "${rest.slice(0, 16)}".`)
    tokens.push(token[0])
    rest = rest.slice(token[0].length)
  }
  return tokens
}

function evaluateExpression(expression, inputs) {
  const tokens = tokenize(expression)
  let position = 0
  const peek = () => tokens[position]
  const take = () => tokens[position++]
  const precedence = { '==': 1, '===': 1, '!=': 1, '!==': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3 }

  function primary() {
    const token = take()
    if (!token) throw new Error('Expression ended unexpectedly.')
    if (token === '(') {
      const value = binary(0)
      if (take() !== ')') throw new Error('Add a closing parenthesis to the expression.')
      return value
    }
    if (token === '-' || token === '+') {
      const value = primary()
      if (typeof value !== 'number') throw new Error(`Unary "${token}" requires a number.`)
      return token === '-' ? -value : value
    }
    if (/^["']/.test(token)) {
      try {
        return token[0] === '"' ? JSON.parse(token) : token.slice(1, -1).replace(/\\(['\\])/g, '$1')
      } catch {
        throw new Error('Check the quoted string in the expression.')
      }
    }
    if (/^\d/.test(token)) return Number(token)
    if (token === 'true') return true
    if (token === 'false') return false
    if (token === 'null') return null
    const value = token.split('.').reduce((result, part) => result?.[part], inputs)
    if (value === undefined) throw new Error(`Unknown variable "${token}".`)
    return value
  }

  function binary(minPrecedence) {
    let left = primary()
    while (precedence[peek()] >= minPrecedence) {
      const operator = take()
      const rank = precedence[operator]
      const right = binary(rank + 1)
      if (operator === '+') left = typeof left === 'string' || typeof right === 'string' ? String(left) + String(right) : left + right
      else if (operator === '-') left -= right
      else if (operator === '*') left *= right
      else if (operator === '/') left /= right
      else if (operator === '%') left %= right
      else if (operator === '==' || operator === '===') left = left === right
      else if (operator === '!=' || operator === '!==') left = left !== right
      else if (operator === '<') left = left < right
      else if (operator === '>') left = left > right
      else if (operator === '<=') left = left <= right
      else if (operator === '>=') left = left >= right
    }
    return left
  }

  if (!tokens.length) throw new Error('Add an expression to this process.')
  const result = binary(0)
  if (position !== tokens.length) throw new Error(`Unexpected token "${peek()}".`)
  return result
}

export function* executeGraphSteps(graph) {
  if (!graph?.nodes?.length) {
    return { ok: false, error: 'Add at least one node before running the workflow.', trace: [] }
  }
  let order
  try {
    order = topologicalSort(graph)
  } catch (error) {
    return { ok: false, error: error.message, trace: [] }
  }
  const values = new Map()
  const trace = []
  const outputs = {}

  for (const node of order) {
    const record = { nodeId: node.id, nodeName: node.name, status: 'success', inputs: {}, outputs: {} }
    try {
      if (node.type === 'input') {
        for (const variable of node.outputs) {
          const value = variable.defaultValue
          if (isMissing(value)) {
            if (variable.required) throw new Error(`Required value "${variable.name}" is missing.`)
            continue
          }
          if (!matchesType(value, variable.type)) throw new Error(`Value "${variable.name}" must be a ${variable.type}.`)
          values.set(variable.id, value)
          record.outputs[variable.name] = value
        }
      } else {
        record.inputs = getInputValues(node, graph, values)
        if (node.type === 'process') {
          for (const variable of node.outputs) {
            const expression = variable.expression || (node.outputs.length === 1 ? node.expression : '')
            let value
            if (expression) value = evaluateExpression(expression, record.inputs)
            else if (Object.hasOwn(record.inputs, variable.name)) value = record.inputs[variable.name]
            else if (node.outputs.length === 1 && Object.keys(record.inputs).length === 1) value = Object.values(record.inputs)[0]
            else throw new Error(`Add an expression or a matching input for output "${variable.name}".`)
            if (!matchesType(value, variable.type)) throw new Error(`Output "${variable.name}" must be a ${variable.type}.`)
            values.set(variable.id, value)
            record.outputs[variable.name] = value
          }
        } else {
          for (const variable of node.inputs) {
            if (Object.hasOwn(record.inputs, variable.name)) outputs[`${node.name}.${variable.name}`] = record.inputs[variable.name]
          }
          record.outputs = { ...record.inputs }
        }
      }
    } catch (error) {
      record.status = 'error'
      record.error = error.message
      trace.push(record)
      yield { step: record, trace: [...trace] }
      return { ok: false, error: `${node.name}: ${error.message}`, failedNodeId: node.id, trace, outputs }
    }
    trace.push(record)
    yield { step: record, trace: [...trace] }
  }
  return { ok: true, outputs, trace }
}

export function executeGraph(graph) {
  const steps = executeGraphSteps(graph)
  let result = steps.next()
  while (!result.done) result = steps.next()
  return result.value
}
