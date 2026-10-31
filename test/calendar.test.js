import test from 'node:test'
import assert from 'node:assert/strict'
import { toCalendarBlock, toCalendarEvent } from '../calendar.js'

test('builds a separate timed calendar event with a 30-minute reminder', () => {
  const block = {
    id: 'block-1',
    task: 'Writing',
    day: '2026-10-30',
    startHour: 14,
    startMinute: 0,
    endHour: 15,
    endMinute: 30,
    source: 'user',
  }
  const event = toCalendarEvent(block, 'America/New_York')

  assert.equal(event.summary, 'Writing')
  assert.match(event.start.dateTime, /^2026-10-30T14:00:00[+-]\d{2}:\d{2}$/)
  assert.equal(event.start.timeZone, 'America/New_York')
  assert.deepEqual(event.reminders.overrides, [{ method: 'popup', minutes: 30 }])
  assert.equal(event.extendedProperties.private.agendaBlockId, 'block-1')
})

test('converts an all-day calendar event to a schedulable conflict block', () => {
  const block = toCalendarBlock({
    id: 'holiday',
    summary: 'Holiday',
    start: { date: '2026-10-30' },
    end: { date: '2026-10-31' },
  })

  assert.equal(block.day, '2026-10-30')
  assert.equal(block.allDay, true)
  assert.equal(block.source, 'google')
})
