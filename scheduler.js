function minutes(hour, minute = 0) {
  return hour * 60 + minute
}

function interval(block) {
  return {
    start: minutes(block.startHour, block.startMinute),
    end: minutes(block.endHour, block.endMinute),
  }
}

export function findConflicts(blocks, events, calendarBlocks) {
  return blocks.flatMap((block) => {
    const proposed = interval(block)
    const eventConflicts = events
      .filter((event) => {
        if (event.status === 'cancelled' || calendarBlocks.some((item) => item.eventId === event.id)) return false
        if (event.start?.date && event.start.date === block.day) return true
        if (!event.start?.dateTime) return false
        const start = new Date(event.start.dateTime)
        const end = new Date(event.end?.dateTime)
        const day = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
        const eventStart = start.getHours() * 60 + start.getMinutes()
        const eventEnd = end.getHours() * 60 + end.getMinutes()
        return day === block.day && proposed.start < eventEnd && proposed.end > eventStart
      })
      .map((event) => ({ block, event, kind: 'google' }))

    const localConflicts = calendarBlocks
      .filter((other) => other.day === block.day && other.id !== block.id)
      .filter((other) => {
        const existing = interval(other)
        return proposed.start < existing.end && proposed.end > existing.start
      })
      .map((other) => ({ block, event: other, kind: 'local' }))
    return [...eventConflicts, ...localConflicts]
  })
}

export function findNextSlot(block, blocks, events, calendarBlocks, now = new Date()) {
  const duration = interval(block).end - interval(block).start
  if (duration <= 0) throw new Error('The scheduled duration must be positive.')
  const initial = new Date(`${block.day}T00:00:00`)
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const date = new Date(initial)
    date.setDate(initial.getDate() + dayOffset)
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
    for (let start = dayOffset === 0 ? interval(block).end : 8 * 60; start + duration <= 18 * 60; start += 30) {
      const candidate = {
        ...block,
        day,
        startHour: Math.floor(start / 60),
        startMinute: start % 60,
        endHour: Math.floor((start + duration) / 60),
        endMinute: (start + duration) % 60,
      }
      if (day === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        && start <= now.getHours() * 60 + now.getMinutes()) continue
      if (findConflicts([candidate], events, blocks.filter((item) => item.id !== block.id).concat(calendarBlocks)).length === 0) {
        return candidate
      }
    }
  }
  throw new Error('No open slot was found in the next 14 days between 8 AM and 6 PM.')
}

export function isConflictEventMoveSafe(event) {
  return event.kind === 'google'
    && Boolean(event.event?.id)
    && Boolean(event.event?.start?.dateTime)
    && Boolean(event.event?.end?.dateTime)
}
