/* Archivo Fork additions — GPL-3.0-or-later. Local-time schedule arithmetic. */
'use strict';
function validateRule(input) {
  const kind = input && input.kind;
  if (kind === 'interval') {
    const minutes = Number(input.minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080) throw Error('Choose an interval from 15 minutes to 7 days.');
    return { kind, minutes };
  }
  if (!['daily', 'weekly'].includes(kind) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) throw Error('Choose a valid local time.');
  const days = kind === 'weekly' ? [...new Set(input.days)].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
  if (kind === 'weekly' && !days.length) throw Error('Select at least one weekday.');
  return { kind, time: input.time, days };
}
function nextRun(rule, after) {
  rule = validateRule(rule);
  const date = new Date(after);
  if (!Number.isFinite(date.getTime())) throw Error('Invalid schedule date.');
  if (rule.kind === 'interval') return date.getTime() + rule.minutes * 60000;
  const [h, m] = rule.time.split(':').map(Number);
  // Calendar days, rather than 24-hour increments, preserve wall-clock time across DST.
  for (let i = 0; i < 9; i++) {
    const n = new Date(date.getFullYear(), date.getMonth(), date.getDate() + i, h, m, 0, 0);
    if (n > date && (rule.kind === 'daily' || rule.days.includes(n.getDay()))) return n.getTime();
  }
  throw Error('Could not calculate next run.');
}
function advance(schedule, now) {
  // Compute from completion, never replay every missed interval. Calendar schedules cannot run twice on a fall-back day.
  return { ...schedule, lastRun: now, nextRun: nextRun(schedule.rule, now) };
}
module.exports = { validateRule, nextRun, advance };
