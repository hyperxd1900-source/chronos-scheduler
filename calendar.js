const API_ROOT = 'https://www.googleapis.com/calendar/v3'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'
const GIS_SCRIPT_ID = 'google-identity-services'
const SESSION_TOKEN_KEY = 'chronos.google.access-token'
const SESSION_AUTHORIZED_KEY = 'chronos.google.authorized'
const sessionTokenStorage = typeof sessionStorage === 'undefined' ? null : sessionStorage

let accessToken = restoreAccessToken()
let accessTokenExpiresAt = Number(sessionTokenStorage?.getItem(`${SESSION_TOKEN_KEY}.expiresAt`) || 0)
let tokenClient = null

function restoreAccessToken() {
  if (!sessionTokenStorage) return null
  const expiresAt = Number(sessionTokenStorage.getItem(`${SESSION_TOKEN_KEY}.expiresAt`) || 0)
  const token = sessionTokenStorage.getItem(SESSION_TOKEN_KEY)
  if (!token || expiresAt <= Date.now()) {
    sessionTokenStorage.removeItem(SESSION_TOKEN_KEY)
    sessionTokenStorage.removeItem(`${SESSION_TOKEN_KEY}.expiresAt`)
    return null
  }
  return token
}

function clearAccessToken() {
  accessToken = null
  accessTokenExpiresAt = 0
  sessionTokenStorage?.removeItem(SESSION_TOKEN_KEY)
  sessionTokenStorage?.removeItem(`${SESSION_TOKEN_KEY}.expiresAt`)
}

function clearAuthorization() {
  sessionTokenStorage?.removeItem(SESSION_AUTHORIZED_KEY)
}

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let script = document.getElementById(GIS_SCRIPT_ID)
    let timer
    if (!script) {
      script = document.createElement('script')
      script.id = GIS_SCRIPT_ID
      script.src = GIS_SCRIPT
      script.async = true
      script.defer = true
      script.onerror = () => {
        window.clearInterval(timer)
        script.remove()
        reject(new Error('Could not load Google Identity Services. Check your internet connection.'))
      }
      document.head.append(script)
    }
    const started = Date.now()
    timer = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer)
        resolve()
      } else if (Date.now() - started > 15000) {
        window.clearInterval(timer)
        script.remove()
        reject(new Error('Google Identity Services did not finish loading.'))
      }
    }, 100)
  })
}

export async function connectGoogle(clientId, onStatus = () => {}) {
  if (!clientId.trim()) throw new Error('Enter a Google OAuth client ID before connecting.')
  if (!window.google?.accounts?.oauth2) await loadGoogleIdentity()
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: (response) => {
        if (response.error) {
          clearAccessToken()
          clearAuthorization()
          reject(new Error(`Google sign-in failed: ${response.error_description || response.error}`))
          return
        }
        accessToken = response.access_token
        accessTokenExpiresAt = Date.now() + Number(response.expires_in) * 1000
        try {
          sessionTokenStorage?.setItem(SESSION_TOKEN_KEY, accessToken)
          sessionTokenStorage?.setItem(`${SESSION_TOKEN_KEY}.expiresAt`, String(accessTokenExpiresAt))
          sessionTokenStorage?.setItem(SESSION_AUTHORIZED_KEY, 'true')
        } catch (error) {
          clearAccessToken()
          reject(new Error(`Could not save the Google Calendar session: ${error.message}`))
          return
        }
        onStatus({ connected: true, expiresIn: response.expires_in })
        resolve()
      },
      error_callback: (error) => reject(new Error(`Google sign-in failed: ${error.message || error.type}`)),
    })
    const hasExistingGrant = Boolean(accessToken || sessionTokenStorage?.getItem(SESSION_AUTHORIZED_KEY) === 'true')
    tokenClient.requestAccessToken({ prompt: hasExistingGrant ? undefined : 'consent' })
  })
}

export function disconnectGoogle() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {})
  }
  clearAccessToken()
  clearAuthorization()
  tokenClient = null
}

export function isGoogleConnected() {
  if (accessToken && accessTokenExpiresAt <= Date.now()) clearAccessToken()
  return Boolean(accessToken)
}

export function prepareGoogle() {
  return loadGoogleIdentity()
}

async function request(path, options = {}) {
  if (!accessToken) throw new Error('Connect Google Calendar before syncing.')
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (response.status === 401) {
    clearAccessToken()
    throw new Error('Google Calendar authorization expired. Reconnect and try again.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message || `Google Calendar request failed (${response.status}).`)
  }
  if (response.status === 204) return null
  return response.json()
}

function eventDateTime(day, hour, minute, timeZone) {
  const local = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
  const offset = -local.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const offsetText = `${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
  return { dateTime: `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetText}`, timeZone }
}

export function toCalendarEvent(block, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return {
    summary: block.task,
    description: 'Scheduled with Agenda.',
    start: eventDateTime(block.day, block.startHour, block.startMinute, timeZone),
    end: eventDateTime(block.day, block.endHour, block.endMinute, timeZone),
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    extendedProperties: { private: { agendaBlockId: block.id } },
  }
}

export async function listEvents(calendarId, timeMin, timeMax) {
  const query = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  })
  const events = []
  let pageToken
  do {
    if (pageToken) query.set('pageToken', pageToken)
    const data = await request(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`)
    events.push(...(data.items || []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return events
}

export async function createEvent(calendarId, block) {
  return request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toCalendarEvent(block)),
  })
}

export async function updateEvent(calendarId, eventId, block) {
  const updatedFields = block.source === 'google'
    ? {
      start: eventDateTime(block.day, block.startHour, block.startMinute, block.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone),
      end: eventDateTime(block.day, block.endHour, block.endMinute, block.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone),
    }
    : toCalendarEvent(block)
  return request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updatedFields),
  })
}

export async function deleteEvent(calendarId, eventId) {
  return request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
}

export async function createEvents(calendarId, blocks) {
  const created = []
  try {
    for (const block of blocks) {
      const event = await createEvent(calendarId, block)
      created.push({ block, event })
    }
    return created
  } catch (error) {
    const rollbackErrors = []
    for (const { event } of created.reverse()) {
      try {
        await deleteEvent(calendarId, event.id)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message)
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${error.message} Some already-created events could not be rolled back: ${rollbackErrors.join('; ')}`)
    }
    throw error
  }
}

export async function deleteEvents(calendarId, eventIds) {
  for (const eventId of eventIds) await deleteEvent(calendarId, eventId)
}

export function toCalendarBlock(event) {
  const start = new Date(event.start?.dateTime || `${event.start?.date}T00:00:00`)
  const end = new Date(event.end?.dateTime || `${event.end?.date}T00:00:00`)
  return {
    id: event.extendedProperties?.private?.agendaBlockId || crypto.randomUUID(),
    task: event.summary || '(untitled event)',
    day: event.start?.date || [
      start.getFullYear(),
      String(start.getMonth() + 1).padStart(2, '0'),
      String(start.getDate()).padStart(2, '0'),
    ].join('-'),
    startHour: start.getHours(),
    startMinute: start.getMinutes(),
    endHour: end.getHours(),
    endMinute: end.getMinutes(),
    source: 'google',
    eventId: event.id,
    allDay: Boolean(event.start?.date),
  }
}
