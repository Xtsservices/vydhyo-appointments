function generateSlots(startTime, endTime, interval, req) {
  const slots = [];
  const toMinutes = t => parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]);
  const toTimeString = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  let start = toMinutes(startTime);
  const end = toMinutes(endTime);

  while (start < end) {
    slots.push({ time: toTimeString(start), status: 'available', appointmentId: null, updatedBy: req.headers.userid, updatedAt: new Date() });
    start += interval;
  }

  return slots;
}
module.exports = generateSlots;