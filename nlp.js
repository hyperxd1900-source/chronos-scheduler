import nlp from 'compromise'
import dates from 'compromise-dates'

nlp.extend(dates)

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_ALIASES = new Map([
  ['sunday', 'sun'], ['sundays', 'sun'], ['sun', 'sun'],
  ['monday', 'mon'], ['mondays', 'mon'], ['mon', 'mon'],
  ['tuesday', 'tue'], ['tuesdays', 'tue'], ['tue', 'tue'], ['tues', 'tue'],
  ['wednesday', 'wed'], ['wednesdays', 'wed'], ['wed', 'wed'],
  ['thursday', 'thu'], ['thursdays', 'thu'], ['thu', 'thu'], ['thur', 'thu'], ['thurs', 'thu'],
  ['friday', 'fri'], ['fridays', 'fri'], ['fri', 'fri'],
  ['saturday', 'sat'], ['saturdays', 'sat'], ['sat', 'sat'],
])

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseClock(hourText, minuteText, meridiemText) {
  let hour = Number(hourText)
  const minute = Number(minuteText || 0)
  const meridiem = meridiemText?.toLowerCase()

  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12 + (meridiem.startsWith('p') ? 12 : 0)
  }
  if (hour > 23) return null
  return hour * 60 + minute
}

function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function parseTime(text) {
  const durationMatch = text.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)\b/i)
  const range = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to|until|through)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
  if (range) {
    const startMeridiem = range[3] || range[6]
    const start = parseClock(range[1], range[2], startMeridiem)
    const end = parseClock(range[4], range[5], range[6])
    if (start !== null && end !== null && end > start) {
      return { start: formatTime(start), end: formatTime(end) }
    }
    return null
  }

  const clocks = []
  const clockPattern = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/gi
  for (const match of text.matchAll(clockPattern)) {
    const suffix = match[3]
    const nearby = text.slice(match.index, match.index + match[0].length + 8)
    const meridiem = suffix || nearby.match(/^\s*(a\.?m\.?|p\.?m\.?)/i)?.[1]
    const value = parseClock(match[1], match[2], meridiem)
    if (value !== null && (meridiem || match[2])) clocks.push(value)
    if (clocks.length === 2) break
  }

  if (clocks.length === 2 && clocks[1] > clocks[0]) {
    return { start: formatTime(clocks[0]), end: formatTime(clocks[1]) }
  }
  if (clocks.length === 1) {
    const start = clocks[0]
    const duration = durationMatch
      ? Number(durationMatch[1]) * (/^(?:h|hr)/i.test(durationMatch[2]) ? 60 : 1)
      : 60
    if (!Number.isInteger(duration) || duration <= 0) return null
    const end = start + duration
    if (end <= 24 * 60) return { start: formatTime(start), end: formatTime(end) }
  }
  return null
}

function parseDays(text, referenceDate) {
  const normalized = text.toLowerCase()
  const hasDaily = /\b(every day|each day|daily|all week)\b/.test(normalized)
  const days = new Set()
  for (const match of normalized.matchAll(/\b(sun(?:day)?s?|mon(?:day)?s?|tues?(?:day)?s?|wed(?:nesday)?s?|thurs?(?:day)?s?|fri(?:day)?s?|sat(?:urday)?s?)\b/g)) {
    const day = DAY_ALIASES.get(match[1])
    if (day) days.add(day)
  }

  if (/\bweekdays?\b/.test(normalized)) ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((day) => days.add(day))
  if (/\bweekends?\b/.test(normalized)) ['sat', 'sun'].forEach((day) => days.add(day))
  if (hasDaily) DAYS.forEach((day) => days.add(day))

  const frequency = hasDaily || days.size > 0
    ? 'weekly'
    : /\b(every week|weekly)\b/.test(normalized) ? 'weekly' : 'once'
  if (days.size === 0) days.add(DAYS[referenceDate.getDay()])
  return { days: DAYS.filter((day) => days.has(day)), frequency }
}

function inferTask(text, timeMatch) {
  let taskText = text.trim()
  if (timeMatch) taskText = taskText.replace(timeMatch[0], ' ')
  taskText = taskText
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, ' ')
    .replace(/\bfor\s+\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b/gi, ' ')
    .replace(/\b(every day|each day|daily|all week|weekdays?|weekends?|every week|weekly|this week|next week|today|tomorrow)\b/gi, ' ')
    .replace(/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, ' ')
    .replace(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/gi, ' ')
    .replace(/\b(?:is|are|am|was|were|be|been|being)\b/gi, ' ')
    .replace(/\b(?:on|every|from|between|for|at|the|a|an)\b/gi, ' ')

  taskText = taskText.replace(/^\s*(?:please\s+)?(?:i\s+(?:would like|want|wanna|need)(?:\s+to)?|can you|could you)\s+/i, '')
  taskText = taskText.replace(/^\s*(?:please\s+)?(?:block(?: out)?|schedule|set aside|reserve|add|put|focus(?: on)?|work on|spend time on)\s+/i, '')
  taskText = taskText.replace(/\s+/g, ' ').replace(/^[\s,–—-]+|[\s,–—-]+$/g, '').trim()
  if (!taskText) return ''

  const parsed = nlp(taskText)
  parsed.dates().remove()
  const nouns = parsed.nouns().out('array')
    .filter((noun) => !/^(?:i|we|you|time|day|week|weekday|weekend)$/i.test(noun.trim()))
  if (nouns.length) return nouns.join(' ').replace(/\s+/g, ' ').trim()

  const verbs = parsed.verbs()
  if (verbs.length) {
    return verbs.toGerund().out('text')
      .replace(/^(?:is|are|am|was|were)\s+/i, '')
      .trim()
  }
  return ''
}

export function parseSchedule(text, referenceDate = new Date()) {
  const source = String(text || '').trim()
  if (!source) throw new Error('Describe the task and time you want to schedule.')

  const time = parseTime(source)
  if (!time) throw new Error('Include a time range, such as “2–3 PM” or “14:00–15:00”.')

  const rawTimeMatch = source.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to|until|through)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i)
  const task = inferTask(source, rawTimeMatch)
  if (!task) throw new Error('Add a task name, for example “coding”.')

  const { days, frequency } = parseDays(source, referenceDate)
  const dateText = rawTimeMatch ? source.replace(rawTimeMatch[0], ' ') : source
  const relativeDay = source.match(/\b(today|tomorrow)\b/i)?.[1]?.toLowerCase()
  const relativeDate = new Date(referenceDate)
  if (relativeDay === 'tomorrow') relativeDate.setDate(relativeDate.getDate() + 1)
  const parsedDate = relativeDay
    ? { start: `${localDateKey(relativeDate)}T00:00:00` }
    : nlp(dateText).dates().get()[0]
  const explicitDate = parsedDate?.start && /\b(today|tomorrow|on (?:\w+ \d{1,2}|sun(?:day)?|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thurs?(?:day)?|fri(?:day)?|sat(?:urday)?)|next \w+)\b/i.test(source)
  return {
    task,
    ...time,
    frequency,
    days: explicitDate ? [DAYS[new Date(parsedDate.start).getDay()]] : days,
    date: explicitDate ? String(parsedDate.start).slice(0, 10) : null,
  }
}

export function expandSchedule(intent, referenceDate = new Date()) {
  const blocks = []
  const selectedDays = new Set(intent.days)
  const dayIndex = new Map(DAYS.map((day, index) => [day, index]))
  const [startHour, startMinute] = intent.start.split(':').map(Number)
  const [endHour, endMinute] = intent.end.split(':').map(Number)
  const durationMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute)
  if (durationMinutes <= 0) throw new Error('The end time must be after the start time.')

  if (intent.date) {
    const startMinutes = startHour * 60 + startMinute
    const targetDate = new Date(`${intent.date}T00:00:00`)
    const targetIsToday = localDateKey(targetDate) === localDateKey(referenceDate)
    if (targetDate < new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
      || (targetIsToday && startMinutes <= referenceDate.getHours() * 60 + referenceDate.getMinutes())) return []
    return [{
      task: intent.task,
      day: intent.date,
      startHour,
      startMinute,
      endHour,
      endMinute,
      source: 'user',
    }]
  }

  const firstDay = new Date(referenceDate)
  firstDay.setHours(0, 0, 0, 0)

  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(firstDay)
    date.setDate(firstDay.getDate() + offset)
    const dayName = DAYS[date.getDay()]
    if (!selectedDays.has(dayName)) continue
    const startMinutes = startHour * 60 + startMinute
    if (offset === 0 && startMinutes <= referenceDate.getHours() * 60 + referenceDate.getMinutes()) continue
    const [year, month, day] = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    const isoDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    blocks.push({
      task: intent.task,
      day: isoDay,
      startHour,
      startMinute,
      endHour,
      endMinute,
      source: 'user',
      dayIndex: dayIndex.get(dayName),
      durationMinutes,
    })
  }
  return blocks.map(({ dayIndex: _dayIndex, durationMinutes: _durationMinutes, ...block }) => block)
}
