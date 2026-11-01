import { connectGoogle, createEvents, deleteEvent, deleteEvents, disconnectGoogle, isGoogleConnected, listEvents, prepareGoogle, toCalendarBlock, updateEvent } from './calendar.js'
import { findConflicts, findNextSlot, isConflictEventMoveSafe } from './scheduler.js'
import { getBlocks, getSettings, saveBlocks, saveSettings } from './storage.js'

const app = document.querySelector('#app')

let blocks = []
let settings = { clientId: '', calendarId: 'primary' }
let calendarEvents = []
let pendingBlocks = []
let pendingConflicts = []
let loading = false
let listening = false
let draftText = ''
let notice = null
let googleReady = Boolean(window.google?.accounts?.oauth2)
let googleLoading = false
let weekOffset = 0
let settingsOpen = false

const recognition = window.SpeechRecognition || window.webkitSpeechRecognition
const speechRecognition = recognition ? new recognition() : null
if (speechRecognition) {
  speechRecognition.continuous = false
  speechRecognition.interimResults = false
  speechRecognition.lang = navigator.language || 'en-US'
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function formatTime(hour, minute) {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDate(day) {
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function blockTime(block) {
  if (block.allDay) return 'All day'
  return `${formatTime(block.startHour, block.startMinute)}–${formatTime(block.endHour, block.endMinute)}`
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getWeekDays(offset = weekOffset) {
  const firstDay = new Date()
  firstDay.setHours(0, 0, 0, 0)
  firstDay.setDate(firstDay.getDate() + offset * 7)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(firstDay)
    date.setDate(firstDay.getDate() + index)
    return date
  })
}

function isSameDay(first, second) {
  return todayKey(first) === todayKey(second)
}

function isEditable(block) {
  return block.source === 'user' || blocks.some((saved) => saved.id === block.id)
}

function getVisibleBlocks() {
  const cachedEvents = calendarEvents.map(toCalendarBlock)
  const knownEventIds = new Set(blocks.map((block) => block.eventId).filter(Boolean))
  const remote = cachedEvents
    .filter((block) => !knownEventIds.has(block.eventId))
    .map((block) => ({ ...block, allDay: Boolean(block.allDay) }))
  return [...blocks, ...remote]
    .sort((a, b) => a.day.localeCompare(b.day) || a.startHour - b.startHour || a.startMinute - b.startMinute)
}

function showMessage(message, type = 'success') {
  notice = { message, type }
  const output = document.querySelector('#notice')
  if (!output) return
  output.className = `notice is-${type}`
  output.textContent = message
  output.hidden = false
}

function clearMessage() {
  notice = null
  const output = document.querySelector('#notice')
  if (!output) return
  output.hidden = true
  output.textContent = ''
}

function render() {
  const visibleBlocks = getVisibleBlocks()
  const weekDays = getWeekDays()
  const blocksByDay = new Map()
  for (const block of visibleBlocks) {
    blocksByDay.set(block.day, [...(blocksByDay.get(block.day) || []), block])
  }
  const weekLabel = `${weekDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
  const schedule = weekDays.map((date) => {
    const day = todayKey(date)
    const dayBlocks = blocksByDay.get(day) || []
    return `
      <section class="calendar-day ${isSameDay(date, new Date()) ? 'is-today' : ''}" aria-label="${escapeHtml(formatDate(day))}">
        <header class="calendar-day-heading">
          <span>${escapeHtml(date.toLocaleDateString([], { weekday: 'short' }))}</span>
          <strong>${date.getDate()}</strong>
        </header>
        <div class="calendar-day-events">
          ${dayBlocks.length ? dayBlocks.map((block) => `
            <article class="calendar-event ${block.source === 'google' ? 'is-external' : ''}">
              ${isEditable(block)
                ? `<button class="calendar-event-main" data-edit-block="${escapeHtml(block.id)}"><span>${escapeHtml(blockTime(block))}</span><strong>${escapeHtml(block.task)}</strong></button>`
                : `<div class="calendar-event-main"><span>${escapeHtml(blockTime(block))}</span><strong>${escapeHtml(block.task)}</strong></div>`}
              ${isEditable(block) ? `<div class="calendar-event-actions"><button class="event-action" data-edit-block="${escapeHtml(block.id)}" aria-label="Edit ${escapeHtml(block.task)}" title="Edit">Edit</button><button class="event-action is-delete" data-delete-block="${escapeHtml(block.id)}" aria-label="Delete ${escapeHtml(block.task)}" title="Delete">×</button></div>` : ''}
            </article>
          `).join('') : '<span class="day-empty">—</span>'}
        </div>
      </section>
    `
  }).join('')

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="Chronos home"><span class="brand-mark">C</span><span>chronos<small>PERSONAL SCHEDULER</small></span></a>
      <button class="connection-button ${isGoogleConnected() ? 'is-connected' : ''}" id="toggle-settings" aria-expanded="false">
        <span class="connection-dot"></span>${isGoogleConnected() ? 'Google Calendar connected' : 'Connect calendar'}
      </button>
    </header>
    <main class="main-content">
      <section class="schedule-section">
        <div class="section-heading">
          <div><span class="eyebrow">YOUR WEEK</span><h1 class="week-title">${escapeHtml(weekLabel)}</h1></div>
          <div class="calendar-controls"><button class="icon-button" id="previous-week" aria-label="Previous week">‹</button><button class="text-button today-button" id="current-week">Today</button><button class="icon-button" id="next-week" aria-label="Next week">›</button><button class="text-button sync-button" id="refresh-calendar" ${isGoogleConnected() ? '' : 'hidden'}>↻ Sync</button></div>
        </div>
        <div class="calendar-scroll"><div class="week-calendar">${schedule}</div></div>
        <p class="calendar-hint">Select a block to edit it. Google Calendar events appear here when connected.</p>
      </section>
      <section class="settings card" id="settings-panel" ${settingsOpen ? '' : 'hidden'}>
        <div><span class="eyebrow">CALENDAR SETUP</span><h2>Connect Google Calendar</h2><p>Create a browser OAuth client in Google Cloud, enable the Calendar API, and add this site’s origin to its authorized JavaScript origins.</p></div>
        <form id="settings-form">
          <label>OAuth client ID<input name="clientId" autocomplete="off" placeholder="123456789.apps.googleusercontent.com" value="${escapeHtml(settings.clientId)}" required /></label>
          <label>Calendar ID<input name="calendarId" autocomplete="off" value="${escapeHtml(settings.calendarId)}" placeholder="primary" /></label>
          <div class="settings-actions"><button class="button button-quiet" id="save-settings" type="button">Save settings</button><button class="button button-primary" type="submit">${isGoogleConnected() ? 'Reconnect' : 'Connect with Google'}</button>${isGoogleConnected() ? '<button class="text-button" id="disconnect-google" type="button">Disconnect</button>' : ''}</div>
        </form>
        <small>Access tokens are kept in this tab’s session storage and cleared when the tab session ends or the token expires. The app requests permission to manage calendar events.</small>
      </section>
    </main>
    <section class="composer-dock" aria-label="Schedule a block">
      <div class="composer">
        <form id="schedule-form">
          <div class="input-row">
            <button type="button" class="voice-button ${listening ? 'is-listening' : ''}" id="voice-button" aria-pressed="${listening}" ${speechRecognition ? '' : 'disabled'} aria-label="Start voice input" title="${speechRecognition ? 'Speak your schedule' : 'Voice input is not supported in this browser'}">⌁</button>
            <textarea id="schedule-input" rows="1" maxlength="400" aria-label="Describe a schedule block" placeholder="Say or type a plan…">${escapeHtml(draftText)}</textarea>
            <button class="button button-primary" type="submit" ${loading ? 'disabled' : ''} aria-label="Schedule block">${loading ? '…' : '↑'}</button>
          </div>
          <p class="form-hint">Try “Code from 2–3 PM every weekday.”</p>
        </form>
        <div id="notice" class="notice ${notice ? `is-${notice.type}` : ''}" role="status" ${notice ? '' : 'hidden'}>${notice ? escapeHtml(notice.message) : ''}</div>
      </div>
    </section>
    <footer class="footer"><span>Private by design · your schedule stays yours</span><span>LOCAL-FIRST · GOOGLE CALENDAR OPTIONAL</span></footer>
    <dialog id="conflict-dialog" class="conflict-dialog">
      <div class="dialog-heading"><div><span class="eyebrow">SCHEDULE CONFLICT</span><h2>There’s something on the calendar</h2><p id="conflict-description"></p></div><button class="icon-button" id="close-dialog" aria-label="Close dialog">×</button></div>
      <div id="conflict-list" class="conflict-list"></div>
      <div class="resolution-actions">
        <button class="button button-primary" data-resolution="move-new">Move my new block</button>
        <button class="button button-quiet" data-resolution="move-existing">Move the existing event</button>
        <button class="button button-quiet" data-resolution="delete-existing">Delete the conflicting event</button>
        <button class="text-button" data-resolution="allow">Allow overlap</button>
        <button class="text-button cancel-button" data-resolution="cancel">Cancel</button>
      </div>
      <small id="resolution-help" class="dialog-help"></small>
    </dialog>
    <dialog id="edit-dialog" class="conflict-dialog edit-dialog">
      <div class="dialog-heading"><div><span class="eyebrow">EDIT SCHEDULE</span><h2>Update this block</h2><p>Changes apply to this day only.</p></div><button class="icon-button" id="close-edit-dialog" aria-label="Close dialog">×</button></div>
      <form id="edit-form">
        <label>What<input name="task" maxlength="200" required /></label>
        <label>Date<input name="day" type="date" required /></label>
        <div class="edit-time-row"><label>Starts<input name="start" type="time" required /></label><label>Ends<input name="end" type="time" required /></label></div>
        <div class="settings-actions"><button class="button button-quiet" id="cancel-edit" type="button">Cancel</button><button class="button button-primary" type="submit">Save changes</button></div>
      </form>
      <small id="edit-help" class="dialog-help"></small>
    </dialog>
  `

  wireHandlers()
}

function wireHandlers() {
  document.querySelector('#schedule-input').addEventListener('input', (event) => {
    draftText = event.target.value
  })
  document.querySelector('#schedule-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void submitSchedule()
  })

  document.querySelector('#toggle-settings').addEventListener('click', (event) => {
    const panel = document.querySelector('#settings-panel')
    settingsOpen = panel.hidden
    const isOpen = settingsOpen
    panel.hidden = !isOpen
    event.currentTarget.setAttribute('aria-expanded', String(isOpen))
    if (isOpen) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (!googleReady && !googleLoading) {
        googleLoading = true
        const connectButton = panel.querySelector('button[type="submit"]')
        connectButton.disabled = true
        connectButton.textContent = 'Loading Google sign-in…'
        void prepareGoogle().then(() => {
          googleReady = true
          googleLoading = false
          if (!panel.hidden) {
            connectButton.disabled = false
            connectButton.textContent = isGoogleConnected() ? 'Reconnect' : 'Connect with Google'
          }
        }).catch((error) => {
          googleLoading = false
          connectButton.disabled = true
          connectButton.textContent = 'Google sign-in unavailable'
          showMessage(error.message, 'error')
        })
      }
    }
  })

  document.querySelector('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void saveAndConnect()
  })
  document.querySelector('#save-settings').addEventListener('click', saveCurrentSettings)

  document.querySelector('#refresh-calendar').addEventListener('click', () => void refreshCalendar())
  document.querySelector('#previous-week').addEventListener('click', () => void changeWeek(-1))
  document.querySelector('#next-week').addEventListener('click', () => void changeWeek(1))
  document.querySelector('#current-week').addEventListener('click', () => void goToCurrentWeek())
  document.querySelector('#voice-button').addEventListener('click', startVoiceInput)
  document.querySelector('#close-dialog').addEventListener('click', closeConflictDialog)
  document.querySelector('#close-edit-dialog').addEventListener('click', closeEditDialog)
  document.querySelector('#cancel-edit').addEventListener('click', closeEditDialog)
  document.querySelector('#edit-form').addEventListener('submit', (event) => {
    event.preventDefault()
    void saveEditedBlock()
  })

  document.querySelector('#conflict-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeConflictDialog()
    const action = event.target.closest('[data-resolution]')
    if (action) void resolveConflict(action.dataset.resolution)
  })

  document.querySelectorAll('[data-delete-block]').forEach((button) => {
    button.addEventListener('click', () => void removeBlock(button.dataset.deleteBlock))
  })
  document.querySelectorAll('[data-edit-block]').forEach((button) => {
    button.addEventListener('click', () => showEditDialog(button.dataset.editBlock))
  })

  document.querySelector('#schedule-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      document.querySelector('#schedule-form').requestSubmit()
    }
  })

  document.querySelector('#disconnect-google')?.addEventListener('click', () => {
    disconnectGoogle()
    calendarEvents = []
    render()
    showMessage('Google Calendar disconnected.', 'info')
  })
}

async function changeWeek(amount) {
  weekOffset += amount
  render()
  if (isGoogleConnected()) {
    try {
      await refreshCalendar(false)
    } catch (error) {
      showMessage(error.message, 'error')
      render()
    }
  }
}

async function goToCurrentWeek() {
  weekOffset = 0
  render()
  if (isGoogleConnected()) {
    try {
      await refreshCalendar(false)
    } catch (error) {
      showMessage(error.message, 'error')
      render()
    }
  }
}

function showEditDialog(id) {
  const block = getVisibleBlocks().find((item) => item.id === id)
  if (!block || !isEditable(block)) return
  const form = document.querySelector('#edit-form')
  form.elements.namedItem('task').value = block.task
  form.elements.namedItem('day').value = block.day
  form.elements.namedItem('start').value = `${String(block.startHour).padStart(2, '0')}:${String(block.startMinute).padStart(2, '0')}`
  form.elements.namedItem('end').value = `${String(block.endHour).padStart(2, '0')}:${String(block.endMinute).padStart(2, '0')}`
  form.dataset.blockId = block.id
  const help = document.querySelector('#edit-help')
  help.textContent = block.eventId && !isGoogleConnected()
    ? 'Reconnect Google Calendar before saving changes to this synced block.'
    : ''
  help.classList.remove('is-error')
  form.querySelector('[type="submit"]').disabled = Boolean(block.eventId && !isGoogleConnected())
  document.querySelector('#edit-dialog').showModal()
}

function closeEditDialog() {
  const dialog = document.querySelector('#edit-dialog')
  if (dialog.open) dialog.close()
}

async function saveEditedBlock() {
  const form = document.querySelector('#edit-form')
  const help = document.querySelector('#edit-help')
  const original = blocks.find((item) => item.id === form.dataset.blockId)
  if (!original) {
    help.textContent = 'This block is no longer available. Refresh the schedule and try again.'
    help.classList.add('is-error')
    return
  }

  const data = new FormData(form)
  const task = String(data.get('task') || '').trim()
  const day = String(data.get('day') || '')
  const start = String(data.get('start') || '')
  const end = String(data.get('end') || '')
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day)
    && todayKey(new Date(`${day}T12:00:00`)) === day
    && day >= todayKey()
  if (!task || !validDay || !start || !end || endHour * 60 + endMinute <= startHour * 60 + startMinute) {
    help.textContent = 'Enter a task, a valid date, and an end time after the start time.'
    help.classList.add('is-error')
    return
  }
  if (original.eventId && !isGoogleConnected()) {
    help.textContent = 'Reconnect Google Calendar before saving changes to this synced block.'
    help.classList.add('is-error')
    return
  }

  const updated = { ...original, task, day, startHour, startMinute, endHour, endMinute }
  const conflicts = findConflicts(
    [updated],
    calendarEvents.filter((event) => event.id !== original.eventId),
    blocks.filter((block) => block.id !== original.id),
  )
  if (conflicts.length) {
    const conflict = conflicts[0]
    help.textContent = `This overlaps ${conflict.kind === 'google' ? conflict.event.summary || 'a calendar event' : conflict.event.task} on ${formatDate(day)}. Choose another time to save.`
    help.classList.add('is-error')
    return
  }

  const submit = form.querySelector('[type="submit"]')
  submit.disabled = true
  help.textContent = ''
  help.classList.remove('is-error')
  try {
    let updatedEvent
    if (original.eventId) updatedEvent = await updateEvent(settings.calendarId, original.eventId, updated)
    const updatedBlocks = blocks.map((block) => block.id === original.id ? updated : block)
    try {
      saveBlocks(updatedBlocks)
    } catch (error) {
      if (original.eventId) {
        try {
          await updateEvent(settings.calendarId, original.eventId, original)
        } catch (rollbackError) {
          throw new Error(`${error.message} Google Calendar also could not be restored: ${rollbackError.message}`)
        }
      }
      throw error
    }
    blocks = updatedBlocks
    if (updatedEvent) {
      const eventIndex = calendarEvents.findIndex((event) => event.id === original.eventId)
      if (eventIndex >= 0) calendarEvents[eventIndex] = updatedEvent
    }
    closeEditDialog()
    render()
    showMessage('Schedule block updated.', 'success')
  } catch (error) {
    help.textContent = error.message
    help.classList.add('is-error')
    submit.disabled = false
  }
}

async function submitSchedule() {
  if (loading) return
  clearMessage()
  const input = document.querySelector('#schedule-input')
  draftText = input.value
  pendingBlocks = []
  pendingConflicts = []
  weekOffset = 0
  loading = true
  render()
  let hasConflicts = false
  let intent
  try {
    const { expandSchedule, parseSchedule } = await import('./nlp.js')
    intent = parseSchedule(draftText, new Date())
    pendingBlocks = expandSchedule(intent, new Date()).map((block) => ({ ...block, id: crypto.randomUUID() }))
    if (!pendingBlocks.length) throw new Error('No dates matched that schedule. Try selecting specific weekdays.')
    if (isGoogleConnected()) {
      const days = pendingBlocks.map((block) => block.day).sort()
      await refreshCalendar(false, [new Date(`${days[0]}T00:00:00`), new Date(`${days[days.length - 1]}T00:00:00`)])
    }
    pendingConflicts = findConflicts(pendingBlocks, calendarEvents, blocks)
    if (pendingConflicts.length) {
      hasConflicts = true
    } else {
      await createPendingBlocks()
      draftText = ''
      showMessage(`${pendingBlocks.length} ${pendingBlocks.length === 1 ? 'block' : 'blocks'} added to your schedule.`, 'success')
      pendingBlocks = []
    }
  } catch (error) {
    showMessage(error.message, 'error')
  } finally {
    loading = false
    render()
  }
  if (hasConflicts && intent) showConflictDialog(intent)
}

function showConflictDialog(intent) {
  document.querySelector('#conflict-description').textContent =
    `${pendingConflicts.length} overlap${pendingConflicts.length === 1 ? 's' : ''} found for “${intent.task}”. Choose how to resolve them before saving.`
  const byEvent = new Map()
  for (const conflict of pendingConflicts) {
    const key = conflict.kind === 'google' ? `google:${conflict.event.id}` : `local:${conflict.event.id}`
    if (!byEvent.has(key)) byEvent.set(key, conflict)
  }
  document.querySelector('#conflict-list').innerHTML = [...byEvent.values()].map(({ block, event, kind }) => {
    const name = kind === 'google' ? event.summary || '(untitled event)' : event.task
    const time = kind === 'google' && event.start?.date
      ? 'All day'
      : kind === 'google'
      ? `${new Date(event.start?.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${new Date(event.end?.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : blockTime(event)
    return `<article class="conflict-item"><span class="conflict-date">${escapeHtml(formatDate(block.day))}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(time)} · ${kind === 'google' ? 'Google Calendar' : 'personal block'}</small></div></article>`
  }).join('')

  const onlyGoogle = pendingConflicts.every(isConflictEventMoveSafe)
  for (const button of document.querySelectorAll('[data-resolution="move-existing"], [data-resolution="delete-existing"]')) {
    button.disabled = !onlyGoogle
    button.title = onlyGoogle ? '' : 'This action is only available for timed Google Calendar events.'
  }
  document.querySelector('#resolution-help').textContent = onlyGoogle
    ? 'Moving or deleting existing events changes your Google Calendar. Deletion is permanent.'
    : 'Existing personal blocks cannot be moved or deleted from this dialog.'
  const dialog = document.querySelector('#conflict-dialog')
  dialog.showModal()
}

function closeConflictDialog() {
  const dialog = document.querySelector('#conflict-dialog')
  if (dialog.open) dialog.close()
}

async function resolveConflict(action) {
  if (action === 'cancel') {
    closeConflictDialog()
    return
  }
  if (action === 'delete-existing' && !window.confirm('Permanently delete the conflicting Google Calendar events?')) return

  const selectedAction = document.querySelector(`[data-resolution="${action}"]`)
  selectedAction.disabled = true
  try {
    if (action === 'move-new') {
      const moved = []
      for (const block of pendingBlocks) {
        moved.push(findNextSlot(block, blocks.concat(moved), calendarEvents, [], new Date()))
      }
      pendingBlocks = moved.map((block, index) => ({ ...block, id: pendingBlocks[index].id }))
      await createPendingBlocks()
      showMessage('Your new blocks were moved to the next available times.', 'success')
    } else if (action === 'move-existing') {
      const unique = [...new Map(pendingConflicts.map(({ event }) => [event.id, event])).values()]
      const workingEvents = [...calendarEvents]
      for (const event of unique) {
        const moved = findNextSlot(toCalendarBlock(event), blocks, workingEvents.filter((item) => item.id !== event.id), [], new Date())
        const updated = await updateEvent(settings.calendarId, event.id, moved)
        const index = workingEvents.findIndex((item) => item.id === event.id)
        if (index >= 0) {
          workingEvents[index] = updated
          calendarEvents[index] = updated
        }
      }
      await createPendingBlocks()
      showMessage('Conflicting calendar events were moved, and your new blocks were added.', 'success')
    } else if (action === 'delete-existing') {
      const uniqueIds = [...new Set(pendingConflicts.map(({ event }) => event.id))]
      for (const eventId of uniqueIds) {
        await deleteEvent(settings.calendarId, eventId)
        calendarEvents = calendarEvents.filter((event) => event.id !== eventId)
      }
      await createPendingBlocks()
      showMessage('Conflicting calendar events were deleted, and your new blocks were added.', 'success')
    } else if (action === 'allow') {
      await createPendingBlocks()
      showMessage('Your blocks were added with the selected overlaps.', 'success')
    }
    draftText = ''
    pendingBlocks = []
    pendingConflicts = []
    closeConflictDialog()
    await refreshCalendar(false)
    render()
  } catch (error) {
    showMessage(error.message, 'error')
    const help = document.querySelector('#resolution-help')
    if (help) {
      help.textContent = error.message
      help.classList.add('is-error')
    }
  } finally {
    if (selectedAction.isConnected) selectedAction.disabled = false
  }
}

async function createPendingBlocks() {
  if (isGoogleConnected()) {
    const created = await createEvents(settings.calendarId, pendingBlocks)
    const additions = created.map(({ block, event }) => ({ ...block, eventId: event.id }))
    try {
      saveBlocks(blocks.concat(additions))
    } catch (error) {
      try {
        await deleteEvents(settings.calendarId, created.map(({ event }) => event.id))
      } catch (rollbackError) {
        throw new Error(`${error.message} The new Google Calendar events could not be rolled back: ${rollbackError.message}`)
      }
      throw error
    }
    blocks = blocks.concat(additions)
    calendarEvents.push(...created.map(({ event }) => event))
  } else {
    saveBlocks(blocks.concat(pendingBlocks))
    blocks = blocks.concat(pendingBlocks)
  }
}

async function refreshCalendar(announce = true, range = getWeekDays()) {
  if (!isGoogleConnected()) return
  try {
    const timeMin = new Date(`${todayKey(range[0])}T00:00:00`)
    const timeMax = new Date(`${todayKey(range[range.length - 1])}T00:00:00`)
    timeMax.setDate(timeMax.getDate() + 1)
    calendarEvents = await listEvents(settings.calendarId, timeMin, timeMax)
    if (announce) showMessage('Google Calendar is up to date.', 'success')
    render()
  } catch (error) {
    if (announce) {
      showMessage(error.message, 'error')
      render()
    }
    else throw error
  }
}

function readFormSettings() {
  const form = document.querySelector('#settings-form')
  const data = new FormData(form)
  return {
    clientId: String(data.get('clientId') || '').trim(),
    calendarId: String(data.get('calendarId') || '').trim() || 'primary',
  }
}

function saveCurrentSettings() {
  try {
    settings = readFormSettings()
    saveSettings(settings)
    showMessage('Calendar settings saved on this device.', 'success')
  } catch (error) {
    showMessage(error.message, 'error')
  }
}

async function saveAndConnect() {
  try {
    settings = readFormSettings()
    if (!settings.clientId) throw new Error('Enter a Google OAuth client ID before connecting.')
    saveSettings(settings)
    await connectGoogle(settings.clientId, () => {
      calendarEvents = []
    })
    render()
    await refreshCalendar(false)
    render()
    showMessage('Google Calendar connected. Your access token will not persist after this tab closes.', 'success')
  } catch (error) {
    showMessage(error.message, 'error')
  }
}

function startVoiceInput() {
  if (!speechRecognition) return
  if (listening) {
    speechRecognition.stop()
    return
  }
  clearMessage()
  listening = true
  updateVoiceButton()
  speechRecognition.onresult = (event) => {
    draftText = event.results[0][0].transcript
    const input = document.querySelector('#schedule-input')
    if (input) input.value = draftText
  }
  speechRecognition.onerror = (event) => showMessage(`Voice input failed: ${event.error}`, 'error')
  speechRecognition.onend = () => {
    listening = false
    updateVoiceButton()
  }
  try {
    speechRecognition.start()
  } catch (error) {
    listening = false
    updateVoiceButton()
    showMessage(error instanceof Error ? error.message : 'Unable to start voice input.', 'error')
  }
}

function updateVoiceButton() {
  const button = document.querySelector('#voice-button')
  if (!button) return
  button.classList.toggle('is-listening', listening)
  button.setAttribute('aria-pressed', String(listening))
  button.title = listening ? 'Listening… tap to stop' : 'Speak your schedule'
}

async function removeBlock(id) {
  const block = blocks.find((item) => item.id === id)
  if (!block) return
  if (!window.confirm(`Delete “${block.task}” from your schedule?`)) return
  try {
    if (block.eventId) {
      if (!isGoogleConnected()) throw new Error('Reconnect Google Calendar to remove this synced event.')
    }
    const updatedBlocks = blocks.filter((item) => item.id !== id)
    saveBlocks(updatedBlocks)
    if (block.eventId) {
      try {
        await deleteEvent(settings.calendarId, block.eventId)
      } catch (error) {
        try {
          saveBlocks(blocks)
        } catch (rollbackError) {
          throw new Error(`${error.message} The local schedule could not be restored: ${rollbackError.message}`)
        }
        throw error
      }
      calendarEvents = calendarEvents.filter((event) => event.id !== block.eventId)
    }
    blocks = updatedBlocks
    render()
    showMessage('Schedule block deleted.', 'success')
  } catch (error) {
    showMessage(error.message, 'error')
  }
}

async function initialize() {
  try {
    blocks = getBlocks()
    settings = getSettings()
    render()
    if (isGoogleConnected()) {
      try {
        await refreshCalendar(false)
      } catch (error) {
        showMessage(error.message, 'error')
        render()
      }
    }
  } catch (error) {
    app.innerHTML = `<main class="fatal-error"><h1>Could not load Chronos</h1><p>${escapeHtml(error.message)}</p></main>`
  }
}

void initialize()
