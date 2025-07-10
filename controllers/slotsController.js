const DoctorSlotModel = require('../models/doctorSlotsModel');
const doctorSlotSchema = require('../schemas/doctorSlotsSchema');
const generateSlots = require('../utils/generateTimeSlots');
const { sortSlotsByTime } = require('../utils/utils');

exports.createSlotsForDoctor = async (req, res) => {
  const requiredFields = ['doctorId', 'addressId', 'dates', 'startTime', 'endTime', 'interval'];
  const missingFields = requiredFields.filter(
    key => req.body[key] === undefined || req.body[key] === null || req.body[key] === ''
  );

  if (missingFields.length > 0) {
    return res.status(400).json({
      status: 'fail',
      message: `${missingFields.join(', ')} ${missingFields.length > 1 ? 'are' : 'is'} required`
    });
  }

  const { doctorId, addressId, dates, startTime, endTime, interval } = req.body;

  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({
      status: 'fail',
      message: 'dates must be a non-empty array'
    });
  }

  const slotsToCreate = generateSlots(startTime, endTime, interval, req);

  const results = [];

  for (const dateStr of dates) {
    const slotDate = new Date(dateStr);
    const { error } = doctorSlotSchema.validate({ doctorId, addressId, date: slotDate, slots: slotsToCreate });
    if (error) {
      return res.status(400).json({
        status: 'fail',
        message: error.details[0].message,
      });
    }

    try {
      const existing = await DoctorSlotModel.findOne({ doctorId, addressId, date: slotDate });

      if (existing) {
        const existingTimes = new Set(existing.slots.map(s => s.time));
        const newUniqueSlots = slotsToCreate.filter(s => !existingTimes.has(s.time));

        if (newUniqueSlots.length > 0) {
          existing.slots.push(...newUniqueSlots);
          existing.slots = sortSlotsByTime(existing.slots);
          await existing.save();

          results.push({ date: dateStr, status: 'appended', added: newUniqueSlots.length });
        } else {
          results.push({ date: dateStr, status: 'skipped', reason: 'All slots already exist' });
        }
      } else {
        const sortedSlots = sortSlotsByTime(slotsToCreate);
        await DoctorSlotModel.create({
          doctorId,
          addressId,
          date: slotDate,
          slots: sortedSlots,
          createdBy: req.headers.userid,
          createdAt: new Date()
        });

        results.push({ date: dateStr, status: 'created', added: sortedSlots.length });
      }
    } catch (err) {
      results.push({ date: dateStr, status: 'error', reason: err.message });
    }
  }

  return res.status(200).json({
    status: 'success',
    message: 'Slot creation processed',
    results
  });
};

exports.getSlotsByDoctorIdAndDate = async (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId and date are required',
    });
  }
  const slotDate = new Date(date);
  const slots = await DoctorSlotModel.findOne({ doctorId, date: slotDate });
  if (!slots) {
    return res.status(404).json({
      status: 'fail',
      message: 'No slots found for this doctor on the specified date',
    });
  }
  return res.status(200).json({ status: 'success', data: slots });
};

exports.updateDoctorSlots = async (req, res) => {
  const { doctorId, date, timeSlots = [] } = req.body;

  if (!doctorId || !date) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId and date are required'
    });
  }

  const slotDate = new Date(date);
  if (isNaN(slotDate.getTime())) {
    return res.status(400).json({
      status: 'fail',
      message: `Invalid date format: '${date}'. Must be in YYYY-MM-DD format.`
    });
  }
  const slotDoc = await DoctorSlotModel.findOne({ doctorId, date: slotDate });

  if (!slotDoc) {
    return res.status(404).json({
      status: 'fail',
      message: 'No slot record found for given doctorId and date'
    });
  }

  const updatedTimes = [];

  slotDoc.slots = slotDoc.slots.map(currentSlot => {
    const shouldUpdate =
      (!timeSlots.length || timeSlots.includes(currentSlot.time)) &&
      currentSlot.status === 'available' &&
      currentSlot.appointmentId === null;

    if (shouldUpdate) {
      updatedTimes.push(currentSlot.time);
      return { ...currentSlot.toObject(), status: 'unavailable', updatedBy: req.headers.userid, updatedAt: new Date() };
    }
    return currentSlot;
  });

  await slotDoc.save();

  return res.status(200).json({
    status: 'success',
    message: updatedTimes.length > 0
      ? `Updated ${updatedTimes.length} slot(s) to 'unavailable'`
      : 'No slots were updated (already unavailable or booked)',
    updatedSlots: updatedTimes,
    date,
    doctorId
  });
};
