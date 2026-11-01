import test from 'node:test'
import assert from 'node:assert/strict'
import { expandSchedule, parseSchedule } from '../nlp.js'

const reference = new Date(2026, 9, 26, 9, 0)

test('parses a daily time range into one block per day for the next seven days', () => {
  const intent = parseSchedule('Block 2–3 PM for coding every day this week', reference)

  assert.equal(intent.task, 'coding')
  assert.equal(intent.start, '14:00')
  assert.equal(intent.end, '15:00')
  assert.equal(intent.frequency, 'weekly')
  assert.deepEqual(intent.days, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])

  const blocks = expandSchedule(intent, reference)
  assert.equal(blocks.length, 7)
  assert.deepEqual(blocks.map((block) => [block.startHour, block.endHour]), Array(7).fill([14, 15]))
})

test('understands weekday names and one-sided meridiem ranges', () => {
  const intent = parseSchedule('Focus on writing from 9 to 10 AM every weekday', reference)
  assert.equal(intent.start, '09:00')
  assert.equal(intent.end, '10:00')
  assert.deepEqual(intent.days, ['mon', 'tue', 'wed', 'thu', 'fri'])
})

test('extracts activity nouns and normalizes action verbs to gerunds', () => {
  const project = parseSchedule('I want to work on my project from 2 to 3 PM', reference)
  const coding = parseSchedule('I wanna code from 2 to 3 PM', reference)

  assert.equal(project.task, 'my project')
  assert.equal(coding.task, 'coding')
})

test('uses compromise-dates to resolve a relative date separately from its time range', () => {
  const intent = parseSchedule('Write tomorrow from 2 to 3 PM', reference)

  assert.equal(intent.task, 'writing')
  assert.equal(intent.date, '2026-10-27')
  assert.deepEqual(expandSchedule(intent, reference).map((block) => block.day), ['2026-10-27'])
})

test('parses a duration after a single start time', () => {
  const intent = parseSchedule('Read at 2 PM for 90 minutes', reference)

  assert.equal(intent.task, 'reading')
  assert.equal(intent.start, '14:00')
  assert.equal(intent.end, '15:30')
})

test('skips a recurring block whose time already passed today', () => {
  const lateReference = new Date(2026, 9, 26, 15, 0)
  const intent = parseSchedule('Block 2–3 PM for coding every day this week', lateReference)

  assert.equal(expandSchedule(intent, lateReference).length, 6)
})

test('rejects missing task names and invalid time ranges', () => {
  assert.throws(() => parseSchedule('Block 2–3 PM every day', reference), /Add a task name/)
  assert.throws(() => parseSchedule('Coding from 3 to 2 PM', reference), /Include a time range/)
})
