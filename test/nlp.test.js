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

test('expands weekly schedules through an inclusive calendar-month duration', () => {
  const intent = parseSchedule('Read every Tuesday from 2 to 3 PM for 3 months', reference)
  const blocks = expandSchedule(intent, reference)

  assert.equal(intent.task, 'reading')
  assert.deepEqual(intent.duration, { endDate: '2027-01-26' })
  assert.deepEqual(blocks.map((block) => block.day), [
    '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17',
    '2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15',
    '2026-12-22', '2026-12-29', '2027-01-05', '2027-01-12',
    '2027-01-19', '2027-01-26',
  ])
})

test('expands a day-based recurrence through its inclusive end date', () => {
  const intent = parseSchedule('Study every Tuesday from 2 to 3 PM for 90 days', reference)
  const blocks = expandSchedule(intent, reference)

  assert.deepEqual(intent.duration, { endDate: '2027-01-24' })
  assert.equal(blocks.at(-1).day, '2027-01-19')
  assert.equal(blocks.length, 13)
})

test('parses quarter and year durations and clamps month-end dates', () => {
  const quarter = parseSchedule('Study every Tuesday from 2 to 3 PM for 1 quarter', reference)
  const year = parseSchedule('Study every Tuesday from 2 to 3 PM for 1 year', reference)
  const monthEnd = parseSchedule(
    'Study every Tuesday from 2 to 3 PM for 1 month',
    new Date(2026, 0, 31, 9, 0),
  )

  assert.deepEqual(quarter.duration, { endDate: '2027-01-26' })
  assert.deepEqual(year.duration, { endDate: '2027-10-26' })
  assert.deepEqual(monthEnd.duration, { endDate: '2026-02-28' })
})

test('rejects a zero-length recurrence duration', () => {
  assert.throws(
    () => parseSchedule('Study every Tuesday from 2 to 3 PM for 0 months', reference),
    /positive whole number/,
  )
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
