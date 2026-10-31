import test from 'node:test'
import assert from 'node:assert/strict'
import { findConflicts, findNextSlot, isConflictEventMoveSafe } from '../scheduler.js'

const proposed = {
  id: 'new',
  task: 'Writing',
  day: '2026-10-29',
  startHour: 14,
  startMinute: 0,
  endHour: 15,
  endMinute: 0,
}

test('detects partial and full timed overlaps but not adjacent blocks', () => {
  const events = [
    { id: 'partial', summary: 'Meeting', start: { dateTime: '2026-10-29T14:30:00-04:00' }, end: { dateTime: '2026-10-29T15:30:00-04:00' } },
    { id: 'adjacent', summary: 'Call', start: { dateTime: '2026-10-29T15:00:00-04:00' }, end: { dateTime: '2026-10-29T16:00:00-04:00' } },
  ]

  assert.deepEqual(findConflicts([proposed], events, []).map(({ event }) => event.id), ['partial'])
})

test('treats an all-day event as a conflict and restricts moving it', () => {
  const allDay = { id: 'holiday', summary: 'Holiday', start: { date: proposed.day }, end: { date: '2026-10-30' } }
  const conflicts = findConflicts([proposed], [allDay], [])

  assert.equal(conflicts.length, 1)
  assert.equal(isConflictEventMoveSafe(conflicts[0]), false)
})

test('finds the next daytime slot after a conflict', () => {
  const event = { id: 'meeting', summary: 'Meeting', start: { dateTime: '2026-10-29T14:00:00-04:00' }, end: { dateTime: '2026-10-29T15:00:00-04:00' } }
  const moved = findNextSlot(proposed, [], [event], [], new Date(2026, 9, 29, 9, 0))

  assert.equal(moved.day, proposed.day)
  assert.deepEqual([moved.startHour, moved.startMinute, moved.endHour, moved.endMinute], [15, 0, 16, 0])
})
