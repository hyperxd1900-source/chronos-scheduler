import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowNode, executeGraph, topologicalSort, validateGraph } from '../workflow-engine.js'

function threeNodeGraph() {
  const input = createWorkflowNode('input', 0, 0)
  input.name = 'Prompt'
  input.outputs[0] = { ...input.outputs[0], type: 'number', defaultValue: 21 }
  const process = createWorkflowNode('process', 300, 0)
  process.name = 'Double it'
  process.inputs[0].type = 'number'
  process.outputs[0].type = 'number'
  process.expression = 'value * 2'
  const output = createWorkflowNode('output', 600, 0)
  output.name = 'Answer'
  output.inputs[0].type = 'number'
  return {
    version: 1,
    nodes: [input, process, output],
    edges: [
      { id: 'edge-1', source: input.id, sourceVariableId: input.outputs[0].id, target: process.id, targetVariableId: process.inputs[0].id },
      { id: 'edge-2', source: process.id, sourceVariableId: process.outputs[0].id, target: output.id, targetVariableId: output.inputs[0].id },
    ],
  }
}

test('executes a connected input, process, and output in deterministic order', () => {
  const graph = threeNodeGraph()
  const result = executeGraph(graph)
  assert.equal(result.ok, true)
  assert.deepEqual(result.trace.map((step) => step.nodeName), ['Prompt', 'Double it', 'Answer'])
  assert.equal(result.trace[1].outputs.result, 42)
  assert.deepEqual(result.outputs, { 'Answer.result': 42 })
})

test('reports a node-specific error for a missing required value', () => {
  const graph = threeNodeGraph()
  graph.nodes[0].outputs[0].defaultValue = null
  const result = executeGraph(graph)
  assert.equal(result.ok, false)
  assert.equal(result.failedNodeId, graph.nodes[0].id)
  assert.match(result.error, /Prompt: Required value "value" is missing/)
  assert.equal(result.trace.at(-1).status, 'error')
})

test('uses an input default when an upstream optional value is missing', () => {
  const graph = threeNodeGraph()
  graph.nodes[0].outputs[0].defaultValue = null
  graph.nodes[0].outputs[0].required = false
  graph.nodes[1].inputs[0].defaultValue = 7
  const result = executeGraph(graph)
  assert.equal(result.ok, true)
  assert.equal(result.trace[1].inputs.value, 7)
  assert.equal(result.outputs['Answer.result'], 14)
})

test('detects a cycle and lists only the nodes in the cycle', () => {
  const graph = threeNodeGraph()
  const [, process] = graph.nodes
  const second = createWorkflowNode('process', 600, 0)
  second.name = 'Second step'
  second.inputs[0].type = 'number'
  second.outputs[0].type = 'number'
  const tail = createWorkflowNode('process', 900, 0)
  tail.name = 'Downstream'
  tail.inputs[0].type = 'number'
  graph.nodes.push(second, tail)
  graph.edges = []
  graph.edges.push(
    { id: 'cycle-1', source: process.id, sourceVariableId: process.outputs[0].id, target: second.id, targetVariableId: second.inputs[0].id },
    { id: 'cycle-2', source: second.id, sourceVariableId: second.outputs[0].id, target: process.id, targetVariableId: process.inputs[0].id },
    { id: 'tail', source: second.id, sourceVariableId: second.outputs[0].id, target: tail.id, targetVariableId: tail.inputs[0].id },
  )
  assert.throws(() => topologicalSort(graph), /Cycle detected between: Double it, Second step/)
  const result = executeGraph(graph)
  assert.equal(result.ok, false)
  assert.match(result.error, /Cycle detected/)
})

test('rejects duplicate incoming connections and incompatible variable types', () => {
  const graph = threeNodeGraph()
  graph.edges.push({ ...graph.edges[0], id: 'duplicate' })
  assert.throws(() => validateGraph(graph), /only have one incoming/)
  graph.edges.pop()
  graph.nodes[1].inputs[0].type = 'string'
  assert.throws(() => validateGraph(graph), /invalid connection/)
})

test('evaluates string expressions without executing arbitrary JavaScript', () => {
  const graph = threeNodeGraph()
  graph.nodes[0].outputs[0] = { ...graph.nodes[0].outputs[0], type: 'string', defaultValue: 'hello' }
  graph.nodes[1].inputs[0].type = 'string'
  graph.nodes[1].outputs[0].type = 'string'
  graph.nodes[1].expression = 'value + " world"'
  graph.nodes[2].inputs[0].type = 'string'
  assert.equal(executeGraph(graph).trace[1].outputs.result, 'hello world')
  graph.nodes[1].expression = 'globalThis.process.exit()'
  assert.match(executeGraph(graph).error, /Unknown variable/)
})
