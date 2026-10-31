const BLOCKS_KEY = 'agenda.blocks.v1'
const SETTINGS_KEY = 'agenda.settings.v1'

function readJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? fallback : JSON.parse(stored)
  } catch (error) {
    throw new Error(`Could not read saved scheduler data: ${error.message}`)
  }
}

export function getBlocks() {
  const blocks = readJson(BLOCKS_KEY, [])
  if (!Array.isArray(blocks)) throw new Error('Saved scheduler blocks are invalid.')
  for (const block of blocks) {
    const valid = block
      && typeof block.id === 'string'
      && typeof block.task === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(block.day)
      && ['startHour', 'startMinute', 'endHour', 'endMinute'].every((key) => Number.isInteger(block[key]))
      && block.startHour >= 0 && block.startHour <= 23
      && block.endHour >= 0 && block.endHour <= 23
      && block.startMinute >= 0 && block.startMinute <= 59
      && block.endMinute >= 0 && block.endMinute <= 59
    if (!valid) throw new Error('Saved scheduler blocks are invalid.')
  }
  return blocks
}

export function saveBlocks(blocks) {
  try {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks))
  } catch (error) {
    throw new Error(`Could not save scheduler blocks: ${error.message}`)
  }
}

export function getSettings() {
  const settings = readJson(SETTINGS_KEY, { clientId: '', calendarId: 'primary' })
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Saved scheduler settings are invalid.')
  }
  return {
    clientId: typeof settings.clientId === 'string' ? settings.clientId : '',
    calendarId: typeof settings.calendarId === 'string' ? settings.calendarId : 'primary',
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (error) {
    throw new Error(`Could not save scheduler settings: ${error.message}`)
  }
}
