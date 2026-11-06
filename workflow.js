import { createWorkflowNode, executeGraphSteps, validateGraph } from './workflow-engine.js'

const STORAGE_KEY = 'chronos.workflow.v1'
const app = document.querySelector('#app')
const emptyGraph = () => ({ version: 1, nodes: [], edges: [] })
const clone = (value) => JSON.parse(JSON.stringify(value))
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const newId = () => crypto.randomUUID()

let graph = emptyGraph()
let selectedNodeId = null
let selectedEdgeId = null
let selectedPort = null
let panel = 'inspector'
let zoom = 1
let pan = { x: 0, y: 0 }
let trace = null
let message = ''
let undoStack = []
let redoStack = []
let gesture = null
let isRunning = false
let isPaused = false
let runToken = 0
let resumeExecution = null

try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) graph = validateGraph(JSON.parse(saved))
} catch (error) {
  message = `Could not load workflow: ${error.message}`
  graph = emptyGraph()
}

function saveGraph() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
  } catch (error) {
    message = `Could not save workflow: ${error.message}`
  }
}

function commit(change) {
  undoStack.push(clone(graph))
  if (undoStack.length > 50) undoStack.shift()
  redoStack = []
  change()
  trace = null
  selectedEdgeId = null
  saveGraph()
  render()
}

function commitField(change, updateCanvas = false) {
  undoStack.push(clone(graph))
  if (undoStack.length > 50) undoStack.shift()
  redoStack = []
  change()
  trace = null
  message = ''
  saveGraph()
  if (updateCanvas) renderCanvas()
  const undo = document.querySelector('#undo')
  const redo = document.querySelector('#redo')
  const reset = document.querySelector('#reset-run')
  if (undo) undo.disabled = false
  if (redo) redo.disabled = true
  if (reset) reset.disabled = true
  const status = document.querySelector('.canvas-status')
  if (status) status.textContent = message || 'All changes are saved locally.'
}

function render() {
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId)
  app.innerHTML = `
    <header class="workflow-topbar">
      <a class="workflow-brand" href="/" aria-label="Chronos workflows home"><span class="workflow-brand-mark">C</span><span>chronos<small>WORKFLOW STUDIO</small></span></a>
      <div class="workflow-actions">
        <button class="tool-button" id="undo" title="Undo" ${undoStack.length ? '' : 'disabled'}>↶ <span>Undo</span></button>
        <button class="tool-button" id="redo" title="Redo" ${redoStack.length ? '' : 'disabled'}>↷ <span>Redo</span></button>
        <span class="toolbar-separator"></span>
        <button class="tool-button" id="zoom-out" title="Zoom out">−</button>
        <span class="zoom-label">${Math.round(zoom * 100)}%</span>
        <button class="tool-button" id="zoom-in" title="Zoom in">+</button>
        <button class="tool-button" id="fit-canvas">Fit</button>
        <span class="toolbar-separator"></span>
        <button class="tool-button" id="remove-edge" ${selectedEdgeId ? '' : 'disabled'}>Remove edge</button>
        <button class="tool-button" id="import-graph">Import</button>
        <button class="tool-button" id="export-graph">Export JSON</button>
        <button class="tool-button" id="reset-run" ${trace || isRunning ? '' : 'disabled'}>Reset run</button>
        <button class="tool-button ${isPaused ? 'is-paused' : ''}" id="pause-run" aria-label="${isPaused ? 'Resume workflow' : 'Pause workflow'}" ${isRunning ? '' : 'disabled'}>${isPaused ? '▶ Resume' : 'Ⅱ Pause'}</button>
        <button class="run-button" id="run-graph" ${isRunning ? 'disabled' : ''}>▶ <span>Run workflow</span></button>
      </div>
    </header>
    <main class="workflow-layout ${isRunning ? 'is-running' : ''}">
      <aside class="node-palette">
        <div class="panel-label">BUILD</div>
        <h1>Node palette</h1>
        <p>Drag a step onto the canvas or click to add it.</p>
        ${['input', 'process', 'output'].map((type) => `
          <button class="palette-card type-${type}" data-add-node="${type}">
            <span class="palette-icon">${type === 'input' ? '↳' : type === 'process' ? 'ƒ' : '⇥'}</span>
            <span><strong>${type[0].toUpperCase() + type.slice(1)}</strong><small>${type === 'input' ? 'Start with values' : type === 'process' ? 'Transform data' : 'Capture results'}</small></span>
            <span class="palette-plus">+</span>
          </button>`).join('')}
        <div class="palette-tip"><span>⌘</span> Click ports to connect variables</div>
        <a class="scheduler-link" href="/scheduler.html">← Open personal scheduler</a>
      </aside>
      <section class="canvas-column">
        <div class="canvas-heading"><div><span class="panel-label">WORKSPACE</span><strong>${graph.nodes.length} ${graph.nodes.length === 1 ? 'node' : 'nodes'}</strong></div><span class="canvas-hint">Scroll to zoom · drag empty space to pan</span></div>
        <div class="canvas-viewport" id="canvas-viewport" aria-label="Workflow graph canvas">
          <div class="canvas-world" id="canvas-world">
            <svg class="connection-layer" id="connection-layer" width="2400" height="1600" aria-label="Workflow connections"></svg>
            <div class="canvas-nodes" id="canvas-nodes"></div>
          </div>
          ${graph.nodes.length ? '<div class="minimap" id="minimap" aria-label="Canvas minimap"></div>' : `
            <div class="canvas-empty"><span class="empty-flow-icon">⌘</span><strong>Your canvas is ready</strong><p>Add an Input, Process, and Output node to create your first workflow.</p><button class="button-primary" data-add-node="input">Add an input node</button></div>`}
          <div class="canvas-status" role="status">${escapeHtml(selectedPort ? 'Choose a compatible input port to connect.' : message || 'All changes are saved locally.')}</div>
        </div>
      </section>
      <aside class="right-panel">
        <div class="panel-tabs">
          <button class="${panel === 'inspector' ? 'is-active' : ''}" data-panel="inspector">Inspector</button>
          <button class="${panel === 'trace' ? 'is-active' : ''}" data-panel="trace">Run trace ${trace ? `<span class="trace-count">${trace.trace.length}</span>` : ''}</button>
        </div>
        ${panel === 'inspector' ? renderInspector(selectedNode) : renderTrace()}
      </aside>
    </main>
    <input id="import-file" type="file" accept=".json,application/json" hidden />
    <dialog class="delete-dialog" id="delete-dialog">
      <form method="dialog"><span class="panel-label">REMOVE NODE</span><h2>Remove this node?</h2>
        <p id="delete-copy"></p><p class="dialog-warning">Connected edges will be removed. Downstream variables will be left unconnected.</p>
        <div class="dialog-actions"><button class="tool-button" value="cancel">Cancel</button><button class="danger-button" id="confirm-delete" value="delete">Delete and orphan connections</button></div>
      </form>
    </dialog>`
  renderCanvas()
  bindUI()
}

function renderInspector(node) {
  if (!node) return `<div class="inspector-empty"><span>◈</span><strong>No node selected</strong><p>Select a node on the canvas to edit its name, variables, and settings.</p></div>`
  const inputs = node.inputs || []
  const outputs = node.outputs || []
  const variables = [...inputs.map((variable) => ({ variable, direction: 'inputs' })), ...outputs.map((variable) => ({ variable, direction: 'outputs' }))]
  return `<div class="inspector-content">
    <div class="inspector-node-title"><span class="node-type-badge type-${node.type}">${node.type}</span><button class="delete-node" id="delete-node" aria-label="Delete node">Delete node</button></div>
    <label class="field-label">Node name<input data-node-field="name" value="${escapeHtml(node.name)}" maxlength="60" required /></label>
    ${node.type === 'process' ? `<label class="field-label">Step description<textarea data-node-field="description" rows="3" placeholder="Describe what this step does">${escapeHtml(node.description || '')}</textarea></label>
      <label class="field-label">Expression <span class="field-help">Use input names; e.g. value * 2</span><input data-node-field="expression" value="${escapeHtml(node.expression || '')}" placeholder="value * 2" /></label>` : ''}
    ${node.type !== 'input' ? `<div class="variable-section-title"><div><strong>Inputs</strong><span>Connected from upstream nodes</span></div><button class="add-variable" data-add-variable="inputs" title="Add input">+</button></div>` : ''}
    ${inputs.length ? inputs.map((variable) => renderVariable(node, variable, 'inputs')).join('') : ''}
    ${node.type === 'input' ? `<div class="variable-section-title"><div><strong>Variables</strong><span>Values to start the workflow</span></div><button class="add-variable" data-add-variable="outputs" title="Add variable">+</button></div>` : ''}
    ${node.type === 'process' ? `<div class="variable-section-title"><div><strong>Outputs</strong><span>Values produced by this step</span></div><button class="add-variable" data-add-variable="outputs" title="Add output">+</button></div>` : ''}
    ${node.type === 'output' ? `<div class="variable-section-title"><div><strong>Results</strong><span>Values surfaced when the workflow runs</span></div><button class="add-variable" data-add-variable="inputs" title="Add result">+</button></div>` : ''}
    ${outputs.length ? outputs.map((variable) => renderVariable(node, variable, 'outputs')).join('') : ''}
    <p class="inspector-footnote">Variable connections require matching types. Defaults use JSON values: text in quotes, numbers as digits, and booleans as true or false.</p>
  </div>`
}

function renderVariable(node, variable, direction) {
  const incoming = graph.edges.some((edge) => edge.targetVariableId === variable.id)
  return `<section class="variable-card" data-variable-id="${escapeHtml(variable.id)}">
    <div class="variable-card-heading"><span class="variable-port ${direction === 'inputs' ? 'port-input' : 'port-output'}"></span><strong>${direction === 'inputs' ? 'Input' : 'Output'} variable</strong><button class="remove-variable" data-remove-variable="${escapeHtml(variable.id)}" data-direction="${direction}" aria-label="Remove ${escapeHtml(variable.name)}" ${incoming ? 'title="Remove this connected variable and its edge"' : ''}>×</button></div>
    <label class="field-label">Name<input data-variable-field="name" value="${escapeHtml(variable.name)}" maxlength="50" /></label>
    <label class="field-label">Description<input data-variable-field="description" value="${escapeHtml(variable.description || '')}" placeholder="What this value represents" maxlength="140" /></label>
    <label class="field-label">Type<select data-variable-field="type">${['string', 'number', 'boolean', 'array', 'object', 'date'].map((type) => `<option value="${type}" ${variable.type === type ? 'selected' : ''}>${type[0].toUpperCase() + type.slice(1)}</option>`).join('')}</select></label>
    <label class="field-label">Default value <span class="field-help">${direction === 'inputs' && incoming ? 'Used only if unconnected' : 'Leave empty for no default'}</span><input data-variable-field="defaultValue" value="${escapeHtml(variable.defaultValue === null || variable.defaultValue === undefined ? '' : JSON.stringify(variable.defaultValue))}" placeholder="${variable.type === 'string' ? '"hello"' : variable.type === 'number' ? '42' : 'JSON value'}" /></label>
    ${node.type === 'process' && direction === 'outputs' ? `<label class="field-label">Output expression<input data-variable-field="expression" value="${escapeHtml(variable.expression || '')}" placeholder="${escapeHtml(node.expression || 'value * 2')}" /></label>` : ''}
    <label class="required-check"><input type="checkbox" data-variable-field="required" ${variable.required ? 'checked' : ''} /><span>Required</span></label>
  </section>`
}

function renderTrace() {
  if (!trace) return `<div class="inspector-empty"><span>▷</span><strong>No run yet</strong><p>Run the workflow to see the values passed through every step, in execution order.</p></div>`
  const running = Boolean(trace.running)
  return `<div class="trace-panel">
    <div class="trace-summary ${running ? 'is-running' : trace.ok ? 'is-success' : 'is-error'}"><span>${running ? '…' : trace.ok ? '✓' : '!'}</span><div><strong>${running ? 'Workflow running' : trace.ok ? 'Workflow completed' : 'Workflow failed'}</strong><small>${running ? `${trace.trace.length} steps completed` : trace.ok ? `${trace.trace.length} steps executed` : escapeHtml(trace.error)}</small></div></div>
    ${trace.trace.length ? trace.trace.map((item, index) => `<article class="trace-step ${item.status === 'error' ? 'is-error' : ''}">
      <div class="trace-step-heading"><span class="trace-index">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(item.nodeName)}</strong><span class="trace-step-status">${item.status === 'error' ? 'Error' : 'Done'}</span></div>
      ${item.error ? `<p class="trace-error">${escapeHtml(item.error)}</p>` : ''}
      ${Object.keys(item.inputs).length ? `<div class="trace-values"><small>INPUTS</small><pre>${escapeHtml(JSON.stringify(item.inputs, null, 2))}</pre></div>` : ''}
      ${Object.keys(item.outputs).length ? `<div class="trace-values"><small>OUTPUTS</small><pre>${escapeHtml(JSON.stringify(item.outputs, null, 2))}</pre></div>` : ''}
    </article>`).join('') : `<p class="trace-no-steps">${escapeHtml(trace.error)}</p>`}
  </div>`
}

function portY(node, variableId, direction) {
  const variables = node[direction] || []
  const index = variables.findIndex((variable) => variable.id === variableId)
  return node.y + 99 + Math.max(0, index) * 47
}

function renderCanvas() {
  const world = document.querySelector('#canvas-world')
  if (!world) return
  world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
  const nodes = document.querySelector('#canvas-nodes')
  nodes.innerHTML = graph.nodes.map((node) => {
    const inbound = node.inputs || []
    const outbound = node.outputs || []
    return `<article class="flow-node type-${node.type} ${selectedNodeId === node.id ? 'is-selected' : ''} ${trace?.failedNodeId === node.id ? 'has-error' : ''}" data-node-id="${escapeHtml(node.id)}" style="left:${node.x}px;top:${node.y}px">
      <header class="flow-node-header"><span class="node-kind-icon">${node.type === 'input' ? '↳' : node.type === 'process' ? 'ƒ' : '⇥'}</span><span class="node-kind">${node.type}</span><button class="node-menu" data-delete="${escapeHtml(node.id)}" aria-label="Delete ${escapeHtml(node.name)}">···</button></header>
      <div class="flow-node-name">${escapeHtml(node.name)}</div>
      ${node.description ? `<p class="flow-node-description">${escapeHtml(node.description)}</p>` : ''}
      <div class="flow-node-ports">
        ${inbound.map((variable) => `<button class="node-port input-port ${selectedPort?.variableId === variable.id ? 'is-connecting' : ''}" data-port="input" data-node="${escapeHtml(node.id)}" data-variable="${escapeHtml(variable.id)}" title="Input: ${escapeHtml(variable.name)}"><span class="port-dot"></span><span>${escapeHtml(variable.name)}</span><small>${variable.type}</small></button>`).join('')}
        ${outbound.map((variable) => `<button class="node-port output-port ${selectedPort?.variableId === variable.id ? 'is-connecting' : ''}" data-port="output" data-node="${escapeHtml(node.id)}" data-variable="${escapeHtml(variable.id)}" title="Output: ${escapeHtml(variable.name)}"><small>${variable.type}</small><span>${escapeHtml(variable.name)}</span><span class="port-dot"></span></button>`).join('')}
      </div>
    </article>`
  }).join('')

  const svg = document.querySelector('#connection-layer')
  const edgeMarkup = graph.edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)
    const target = graph.nodes.find((node) => node.id === edge.target)
    if (!source || !target) return ''
    const sourceVariable = source.outputs.find((variable) => variable.id === edge.sourceVariableId)
    const targetVariable = target.inputs.find((variable) => variable.id === edge.targetVariableId)
    if (!sourceVariable || !targetVariable) return ''
    const x1 = source.x + 260
    const y1 = portY(source, sourceVariable.id, 'outputs')
    const x2 = target.x
    const y2 = portY(target, targetVariable.id, 'inputs')
    const control = Math.max(45, Math.abs(x2 - x1) / 2)
    return `<path class="edge-hit-target ${selectedEdgeId === edge.id ? 'is-selected' : ''}" d="M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}" data-edge="${escapeHtml(edge.id)}"/><path class="workflow-edge ${selectedEdgeId === edge.id ? 'is-selected' : ''}" d="M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}" marker-end="url(#edge-arrow)"/>`
  }).join('')
  svg.innerHTML = `<defs><marker id="edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#9f5662"/></marker></defs>${edgeMarkup}`
  renderMinimap()
}

function renderMinimap() {
  const minimap = document.querySelector('#minimap')
  if (!minimap) return
  const viewport = document.querySelector('#canvas-viewport').getBoundingClientRect()
  const viewX = -pan.x / zoom
  const viewY = -pan.y / zoom
  const viewWidth = viewport.width / zoom
  const viewHeight = viewport.height / zoom
  minimap.innerHTML = `<span>MINIMAP</span><svg viewBox="0 0 2400 1600">${graph.edges.map((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source)
    const target = graph.nodes.find((node) => node.id === edge.target)
    return source && target ? `<path d="M${source.x + 260},${source.y + 70} L${target.x},${target.y + 70}"/>` : ''
  }).join('')}${graph.nodes.map((node) => `<rect x="${node.x}" y="${node.y}" width="260" height="130" rx="8" class="mini-${node.type}"/>`).join('')}<rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" class="mini-viewport"/></svg>`
}

function addNode(type, position) {
  const viewport = document.querySelector('#canvas-viewport')
  const rect = viewport.getBoundingClientRect()
  const index = graph.nodes.length
  const x = position ? (position.x - rect.left - pan.x) / zoom : 70 + (index % 4) * 320
  const y = position ? (position.y - rect.top - pan.y) / zoom : 180 + Math.floor(index / 4) * 220
  const node = createWorkflowNode(type, Math.max(24, Math.round(x)), Math.max(24, Math.round(y)))
  commit(() => {
    graph.nodes.push(node)
    selectedNodeId = node.id
    panel = 'inspector'
  })
  if (!position) fitCanvas()
}

function connectPorts(inputNodeId, inputVariableId) {
  if (!selectedPort || selectedPort.nodeId === inputNodeId) {
    selectedPort = null
    render()
    return
  }
  const source = graph.nodes.find((node) => node.id === selectedPort.nodeId)
  const target = graph.nodes.find((node) => node.id === inputNodeId)
  const sourceVariable = source?.outputs?.find((variable) => variable.id === selectedPort.variableId)
  const targetVariable = target?.inputs?.find((variable) => variable.id === inputVariableId)
  if (!sourceVariable || !targetVariable) {
    message = 'Choose an output port first, then an input port.'
    selectedPort = null
    render()
    return
  }
  if (sourceVariable.type !== targetVariable.type) {
    message = `Cannot connect ${sourceVariable.type} to ${targetVariable.type}. Change the variable types to match.`
    selectedPort = null
    render()
    return
  }
  commit(() => {
    graph.edges = graph.edges.filter((edge) => !(edge.target === inputNodeId && edge.targetVariableId === inputVariableId))
    graph.edges.push({ id: newId(), source: source.id, sourceVariableId: sourceVariable.id, target: target.id, targetVariableId: targetVariable.id })
    selectedNodeId = target.id
    selectedPort = null
    message = ''
  })
}

function bindUI() {
  document.querySelectorAll('[data-add-node]').forEach((button) => {
    button.addEventListener('click', () => addNode(button.dataset.addNode))
  })
  document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => {
    panel = button.dataset.panel
    render()
  }))
  document.querySelector('#canvas-nodes').addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete]')
    if (deleteButton) return requestDelete(deleteButton.dataset.delete)
    const port = event.target.closest('[data-port]')
    if (port) {
      if (port.dataset.port === 'output') {
        selectedPort = { nodeId: port.dataset.node, variableId: port.dataset.variable }
        selectedNodeId = port.dataset.node
        message = ''
        render()
      } else connectPorts(port.dataset.node, port.dataset.variable)
      return
    }
    const nodeElement = event.target.closest('[data-node-id]')
    if (nodeElement) {
      selectedNodeId = nodeElement.dataset.nodeId
      selectedEdgeId = null
      panel = 'inspector'
      render()
    }
  })
  document.querySelector('#canvas-viewport').addEventListener('click', (event) => {
    const edge = event.target.closest('[data-edge]')
    if (edge) {
      selectedEdgeId = edge.dataset.edge
      selectedNodeId = null
      render()
    }
  })
  document.querySelector('#minimap')?.addEventListener('click', (event) => {
    const svg = event.currentTarget.querySelector('svg')
    const rect = svg.getBoundingClientRect()
    const graphX = (event.clientX - rect.left) / rect.width * 2400
    const graphY = (event.clientY - rect.top) / rect.height * 1600
    const viewportRect = document.querySelector('#canvas-viewport').getBoundingClientRect()
    pan = { x: viewportRect.width / 2 - graphX * zoom, y: viewportRect.height / 2 - graphY * zoom }
    renderCanvas()
  })
  document.querySelectorAll('[data-add-variable]').forEach((button) => button.addEventListener('click', () => {
    const node = graph.nodes.find((item) => item.id === selectedNodeId)
    if (!node) return
    const direction = button.dataset.addVariable
    const variables = node[direction]
    let name = direction === 'inputs' ? 'input' : 'value'
    let suffix = 2
    while (variables.some((variable) => variable.name === name)) name = `${direction === 'inputs' ? 'input' : 'value'}_${suffix++}`
    const variable = { id: newId(), name, description: '', type: 'string', required: true, defaultValue: null }
    commit(() => variables.push(variable))
  }))
  document.querySelectorAll('[data-remove-variable]').forEach((button) => button.addEventListener('click', () => {
    const node = graph.nodes.find((item) => item.id === selectedNodeId)
    if (!node) return
    const variableId = button.dataset.removeVariable
    commit(() => {
      node[button.dataset.direction] = node[button.dataset.direction].filter((variable) => variable.id !== variableId)
      graph.edges = graph.edges.filter((edge) => edge.sourceVariableId !== variableId && edge.targetVariableId !== variableId)
    })
  }))
  document.querySelectorAll('[data-node-field]').forEach((field) => field.addEventListener('change', () => {
    const node = graph.nodes.find((item) => item.id === selectedNodeId)
    if (!node) return
    const value = field.value.trim()
    if (field.dataset.nodeField === 'name' && !value) {
      field.setCustomValidity('Enter a name for this node.')
      field.reportValidity()
      return
    }
    field.setCustomValidity('')
    const key = field.dataset.nodeField
    commitField(() => { node[key] = value }, key === 'name' || key === 'description')
  }))
  document.querySelectorAll('[data-variable-field]').forEach((field) => {
    const update = () => updateVariableField(field)
    field.addEventListener('change', update)
  })
  document.querySelector('#delete-node')?.addEventListener('click', () => requestDelete(selectedNodeId))
  document.querySelector('#confirm-delete').addEventListener('click', (event) => {
    if (event.currentTarget.value !== 'delete') return
    event.preventDefault()
    const id = document.querySelector('#delete-dialog').dataset.nodeId
    document.querySelector('#delete-dialog').close()
    commit(() => {
      graph.nodes = graph.nodes.filter((item) => item.id !== id)
      graph.edges = graph.edges.filter((edge) => edge.source !== id && edge.target !== id)
      selectedNodeId = null
    })
  })
  document.querySelector('#delete-dialog').addEventListener('submit', (event) => {
    if (event.submitter?.id === 'confirm-delete') event.preventDefault()
  })
  document.querySelector('#undo').addEventListener('click', () => {
    if (!undoStack.length) return
    redoStack.push(clone(graph))
    graph = undoStack.pop()
    selectedNodeId = null
    selectedEdgeId = null
    trace = null
    saveGraph()
    render()
  })
  document.querySelector('#redo').addEventListener('click', () => {
    if (!redoStack.length) return
    undoStack.push(clone(graph))
    graph = redoStack.pop()
    selectedNodeId = null
    selectedEdgeId = null
    trace = null
    saveGraph()
    render()
  })
  document.querySelector('#remove-edge').addEventListener('click', () => {
    if (!selectedEdgeId) return
    commit(() => { graph.edges = graph.edges.filter((edge) => edge.id !== selectedEdgeId) })
  })
  document.querySelector('#run-graph').addEventListener('click', () => void runWorkflow())
  document.querySelector('#pause-run').addEventListener('click', () => {
    if (!isRunning) return
    isPaused = !isPaused
    if (!isPaused) {
      resumeExecution?.()
      resumeExecution = null
    }
    render()
  })
  document.querySelector('#reset-run').addEventListener('click', resetRun)
  document.querySelector('#zoom-in').addEventListener('click', () => changeZoom(1.15))
  document.querySelector('#zoom-out').addEventListener('click', () => changeZoom(1 / 1.15))
  document.querySelector('#fit-canvas').addEventListener('click', fitCanvas)
  document.querySelector('#canvas-viewport').addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.deltaY) {
      event.preventDefault()
      changeZoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX, event.clientY)
    }
  }, { passive: false })
  document.querySelector('#export-graph').addEventListener('click', exportGraph)
  document.querySelector('#import-graph').addEventListener('click', () => document.querySelector('#import-file').click())
  document.querySelector('#import-file').addEventListener('change', importGraph)
}

async function runWorkflow() {
  if (isRunning) return
  const token = ++runToken
  const steps = executeGraphSteps(graph)
  isRunning = true
  isPaused = false
  trace = { ok: null, running: true, trace: [] }
  panel = 'trace'
  message = 'Workflow is running.'
  render()
  while (token === runToken) {
    if (isPaused) await new Promise((resolve) => { resumeExecution = resolve })
    if (token !== runToken) return
    const result = steps.next()
    if (result.done) {
      trace = result.value
      isRunning = false
      isPaused = false
      resumeExecution = null
      message = trace.ok ? 'Workflow completed successfully.' : trace.error
      render()
      return
    }
    trace = { ok: null, running: true, trace: result.value.trace }
    render()
    await new Promise((resolve) => setTimeout(resolve, 180))
  }
}

function resetRun() {
  runToken += 1
  isRunning = false
  isPaused = false
  resumeExecution?.()
  resumeExecution = null
  trace = null
  panel = 'inspector'
  message = 'Run reset.'
  render()
}

function bindCanvasGestures() {
  document.addEventListener('pointerdown', (event) => {
    const paletteCard = event.target.closest('.palette-card[data-add-node]')
    if (paletteCard && event.button === 0) {
      const ghost = document.createElement('div')
      ghost.className = `node-drag-ghost type-${paletteCard.dataset.addNode}`
      ghost.textContent = `+ ${paletteCard.dataset.addNode}`
      ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`
      document.body.append(ghost)
      gesture = {
        kind: 'new-node',
        type: paletteCard.dataset.addNode,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
        ghost,
      }
      return
    }
    const output = event.target.closest('[data-port="output"]')
    if (output && event.button === 0) {
      gesture = {
        kind: 'connect',
        source: { nodeId: output.dataset.node, variableId: output.dataset.variable },
      }
      event.preventDefault()
      return
    }
    const viewport = event.target.closest('#canvas-viewport')
    if (!viewport) return
    if (event.target.closest('.flow-node, .minimap, .canvas-empty, .canvas-status') || event.button !== 0) return
    gesture = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y }
    viewport.classList.add('is-panning')
    viewport.setPointerCapture(event.pointerId)
  })
  document.addEventListener('pointerdown', (event) => {
    const header = event.target.closest('.flow-node-header')
    if (!header || event.target.closest('button')) return
    const nodeElement = header.closest('[data-node-id]')
    const node = graph.nodes.find((item) => item.id === nodeElement.dataset.nodeId)
    gesture = { kind: 'move', nodeId: node.id, x: node.x, y: node.y, clientX: event.clientX, clientY: event.clientY, before: clone(graph), moved: false }
    selectedNodeId = node.id
    document.body.classList.add('is-dragging-node')
    event.preventDefault()
  })
  document.addEventListener('pointermove', (event) => {
    if (!gesture) return
    if (gesture.kind === 'new-node') {
      const dx = event.clientX - gesture.clientX
      const dy = event.clientY - gesture.clientY
      gesture.moved ||= Math.hypot(dx, dy) > 5
      gesture.ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`
      return
    }
    if (gesture.kind === 'connect') {
      const source = graph.nodes.find((node) => node.id === gesture.source.nodeId)
      const variable = source?.outputs.find((item) => item.id === gesture.source.variableId)
      if (!source || !variable) return
      const rect = document.querySelector('#canvas-viewport').getBoundingClientRect()
      const x1 = source.x + 260
      const y1 = portY(source, variable.id, 'outputs')
      const x2 = (event.clientX - rect.left - pan.x) / zoom
      const y2 = (event.clientY - rect.top - pan.y) / zoom
      document.querySelector('.temporary-edge')?.remove()
      document.querySelector('#connection-layer').insertAdjacentHTML('beforeend', `<path class="temporary-edge" d="M${x1} ${y1} C${x1 + 70} ${y1},${x2 - 70} ${y2},${x2} ${y2}"/>`)
      return
    }
    const dx = (event.clientX - gesture.clientX) / zoom
    const dy = (event.clientY - gesture.clientY) / zoom
    if (gesture.kind === 'move') {
      const node = graph.nodes.find((item) => item.id === gesture.nodeId)
      if (node) {
        node.x = Math.max(0, gesture.x + dx)
        node.y = Math.max(0, gesture.y + dy)
        gesture.moved ||= dx !== 0 || dy !== 0
        renderCanvas()
      }
    } else {
      pan.x = gesture.panX + event.clientX - gesture.clientX
      pan.y = gesture.panY + event.clientY - gesture.clientY
      renderCanvas()
    }
  })
  document.addEventListener('pointerup', (event) => {
    if (!gesture) return
    if (gesture.kind === 'new-node') {
      const { moved, type, ghost } = gesture
      ghost.remove()
      if (moved) addNode(type, { x: event.clientX, y: event.clientY })
    } else if (gesture.kind === 'connect') {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-port="input"]')
      document.querySelector('.temporary-edge')?.remove()
      if (target) {
        selectedPort = gesture.source
        connectPorts(target.dataset.node, target.dataset.variable)
      }
    } else if (gesture.kind === 'move') {
      if (gesture.moved) {
        undoStack.push(gesture.before)
        if (undoStack.length > 50) undoStack.shift()
        redoStack = []
        saveGraph()
        render()
      }
    } else {
      document.querySelector('#canvas-viewport')?.classList.remove('is-panning')
    }
    gesture = null
    document.body.classList.remove('is-dragging-node')
  })
  document.addEventListener('keydown', (event) => {
    const command = event.ctrlKey || event.metaKey
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      document.querySelector(event.shiftKey ? '#redo' : '#undo')?.click()
    } else if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      document.querySelector('#redo')?.click()
    } else if (event.key === 'Delete' && selectedEdgeId && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      document.querySelector('#remove-edge')?.click()
    }
  })
}

function updateVariableField(field) {
  const node = graph.nodes.find((item) => item.id === selectedNodeId)
  const variable = [...(node?.inputs || []), ...(node?.outputs || [])].find((item) => item.id === field.closest('[data-variable-id]')?.dataset.variableId)
  if (!variable) return
  const key = field.dataset.variableField
  let value = field.type === 'checkbox' ? field.checked : field.value
  if (key === 'name') {
    value = value.trim()
    if (!value || [...(node.inputs || []), ...(node.outputs || [])].some((item) => item !== variable && item.name === value)) {
      field.setCustomValidity(value ? 'Variable names must be unique within the node.' : 'Enter a variable name.')
      field.reportValidity()
      return
    }
    field.setCustomValidity('')
  }
  if (key === 'defaultValue') {
    if (!value.trim()) value = null
    else {
      try {
        value = JSON.parse(value)
      } catch {
        field.setCustomValidity('Enter a valid JSON value, such as "hello", 42, true, or [1, 2].')
        field.reportValidity()
        return
      }
      field.setCustomValidity('')
    }
  }
  if (key === 'type') {
    const connected = graph.edges.some((edge) => (edge.sourceVariableId === variable.id || edge.targetVariableId === variable.id)
      && (() => {
        const peerId = edge.sourceVariableId === variable.id ? edge.targetVariableId : edge.sourceVariableId
        const peer = [...graph.nodes.flatMap((item) => [...(item.inputs || []), ...(item.outputs || [])])].find((item) => item.id === peerId)
        return peer?.type !== value
      })())
    if (connected) {
      field.value = variable.type
      message = 'Changing this type would invalidate a connection. Remove or reconnect the edge first.'
      const status = document.querySelector('.canvas-status')
      if (status) status.textContent = message
      return
    }
  }
  commitField(() => { variable[key] = value }, key === 'name' || key === 'type')
}

function requestDelete(id) {
  const node = graph.nodes.find((item) => item.id === id)
  if (!node) return
  const connectedCount = graph.edges.filter((edge) => edge.source === id || edge.target === id).length
  document.querySelector('#delete-copy').textContent = connectedCount
    ? `“${node.name}” has ${connectedCount} connected ${connectedCount === 1 ? 'edge' : 'edges'}.`
    : `“${node.name}” is not connected to another node.`
  const dialog = document.querySelector('#delete-dialog')
  dialog.dataset.nodeId = id
  dialog.showModal()
}

function changeZoom(factor, clientX, clientY) {
  const nextZoom = Math.min(1.6, Math.max(0.35, zoom * factor))
  if (clientX !== undefined && clientY !== undefined) {
    const rect = document.querySelector('#canvas-viewport').getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    pan.x = x - (x - pan.x) * (nextZoom / zoom)
    pan.y = y - (y - pan.y) * (nextZoom / zoom)
  }
  zoom = nextZoom
  render()
}

function fitCanvas() {
  if (!graph.nodes.length) {
    zoom = 1
    pan = { x: 0, y: 0 }
    render()
    return
  }
  const viewport = document.querySelector('#canvas-viewport').getBoundingClientRect()
  const minX = Math.min(...graph.nodes.map((node) => node.x))
  const minY = Math.min(...graph.nodes.map((node) => node.y))
  const maxX = Math.max(...graph.nodes.map((node) => node.x + 260))
  const maxY = Math.max(...graph.nodes.map((node) => node.y + 170))
  zoom = Math.min(1.3, Math.max(0.35, Math.min((viewport.width - 80) / (maxX - minX + 80), (viewport.height - 80) / (maxY - minY + 80))))
  pan = { x: (viewport.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (viewport.height - (maxY - minY) * zoom) / 2 - minY * zoom }
  render()
}

function exportGraph() {
  const file = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `chronos-workflow-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

async function importGraph(event) {
  const [file] = event.target.files || []
  if (!file) return
  try {
    const imported = validateGraph(JSON.parse(await file.text()))
    commit(() => {
      graph = clone(imported)
      selectedNodeId = null
      message = `Imported ${graph.nodes.length} nodes and ${graph.edges.length} connections.`
    })
    fitCanvas()
  } catch (error) {
    message = `Could not import workflow: ${error.message}`
    render()
  } finally {
    event.target.value = ''
  }
}

render()
bindCanvasGestures()
