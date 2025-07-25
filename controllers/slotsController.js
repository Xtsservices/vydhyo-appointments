const DoctorSlotModel = require('../models/doctorSlotsModel');
const doctorSlotSchema = require('../schemas/doctorSlotsSchema');
const generateSlots = require('../utils/generateTimeSlots');
const { sortSlotsByTime } = require('../utils/utils');
const Joi = require('joi');


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
      const existing = await DoctorSlotModel.findOne({ doctorId, addressId, date: new Date(slotDate) });
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
          date: new Date(slotDate),
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
  const { doctorId, date, addressId } = req.query;
  if (!doctorId || !date || !addressId) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId, date, and addressId are required',
    });
  }
  const slotDate = new Date(date);
  const slots = await DoctorSlotModel.findOne({ doctorId, addressId, date: slotDate });
  if (!slots) {
    return res.status(404).json({
      status: 'fail',
      message: 'No slots found for this doctor on the specified date',
    });
  }
  return res.status(200).json({ status: 'success', data: slots });
};

exports.updateDoctorSlots = async (req, res) => {
  const { doctorId, date, timeSlots = [], addressId } = req.body;

  if (!doctorId || !date || !addressId) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId, date, and addressId are required'
    });
  }

  const slotDate = new Date(date);
  if (isNaN(slotDate.getTime())) {
    return res.status(400).json({
      status: 'fail',
      message: `Invalid date format: '${date}'. Must be in YYYY-MM-DD format.`
    });
  }
  const slotDoc = await DoctorSlotModel.findOne({ doctorId, addressId, date: slotDate });

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

exports.getNextAvailableSlotsByDoctorAndAddress = async (req, res) => {
  const { doctorId, addressId } = req.query;

  if (!doctorId || !addressId) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId and addressId are required query parameters',
    });
  }

  const today = new Date();

  // Step 1: Fetch documents with at least one available slot
  const allDocs = await DoctorSlotModel.find({
    doctorId,
    addressId,
    date: { $gte: today },
    'slots.status': 'available'
  }).sort({ date: 1 });

  // Step 2: Filter slots manually based on current time and status
  const now = new Date();
  const results = [];

  for (const doc of allDocs) {
    const slotDate = new Date(doc.date).toISOString().split('T')[0];

    const filteredSlots = doc.slots.filter(slot => {
      if (slot.status !== 'available') return false;

      const slotDateTime = new Date(`${slotDate}T${slot.time}:00`);
      return slotDateTime > now;
    });

    if (filteredSlots.length > 0) {
      results.push({
        doctorId: doc.doctorId,
        addressId: doc.addressId,
        date: slotDate,
        slots: filteredSlots
      });
    }

    if (results.length >= 3) break;
  }

  if (results.length === 0) {
    return res.status(404).json({
      status: 'fail',
      message: 'No upcoming available slots found for this doctor',
    });
  }

  return res.status(200).json({
    status: 'success',
    data: results
  });
};

exports.getNextAvailableSlotsByDoctor = async (req, res) => {
  const { doctorId } = req.query;

  if (!doctorId) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId is a required query parameter',
    });
  }

  const now = new Date();

  // Normalize today and tomorrow to midnight UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const dayAfter = new Date(today);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 2);

  // Step 1: Fetch today and tomorrow’s slots for doctor across all addresses
  const allDocs = await DoctorSlotModel.find({
    doctorId,
    date: { $gte: today, $lt: dayAfter },
    'slots.status': 'available'
  }).sort({ date: 1 });

  const results = [];

  for (const doc of allDocs) {
    const slotDate = new Date(doc.date);
    const dateStr = slotDate.toISOString().split('T')[0];
    const isToday = slotDate.toISOString().split('T')[0] === now.toISOString().split('T')[0];

    const filteredSlots = doc.slots.filter(slot => {
      if (slot.status !== 'available') return false;

      if (isToday) {
        const slotDateTime = new Date(`${dateStr}T${slot.time}:00`);
        return slotDateTime > now;
      }

      return true; // For tomorrow, include all available slots
    });

    if (filteredSlots.length > 0) {
      results.push({
        doctorId: doc.doctorId,
        addressId: doc.addressId,
        date: dateStr,
        slots: filteredSlots
      });
    }
  }

  if (results.length === 0) {
    return res.status(404).json({
      status: 'fail',
      message: 'No available slots found for today or tomorrow',
    });
  }

  return res.status(200).json({
    status: 'success',
    data: results
  });
};

exports.deleteDoctorSlots = async (req, res) => {
  // Define schema for payload validation
  const deleteSlotSchema = Joi.object({
    doctorId: Joi.string().required().messages({
      'any.required': 'doctorId is required',
    }),
    addressId: Joi.string().required().messages({
      'any.required': 'addressId is required',
    }),
    date: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required()
      .messages({
        'string.pattern.base': 'date must be in YYYY-MM-DD format',
        'any.required': 'date is required',
      }),
    slotTimes: Joi.array()
      .items(
        Joi.string()
          .pattern(/^([0-1]\d|2[0-3]):([0-5]\d)$/)
          .messages({
            'string.pattern.base': 'Each slot time must be in HH:MM 24-hour format',
          })
      )
      .min(1)
      .required()
      .messages({
        'array.min': 'slotTimes must contain at least one time slot',
        'any.required': 'slotTimes is required',
      }),
  });

  // Validate payload
  const { error, value } = deleteSlotSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: 'fail',
      message: error.details[0].message,
    });
  }

  const { doctorId, addressId, date, slotTimes } = value;

  // Normalize date to midnight UTC
  const slotDate = new Date(date);
  if (isNaN(slotDate.getTime())) {
    return res.status(400).json({
      status: 'fail',
      message: `Invalid date format: '${date}'. Must be in YYYY-MM-DD format.`,
    });
  }
  slotDate.setUTCHours(0, 0, 0, 0);

  try {
    // Find the slot document
    const slotDoc = await DoctorSlotModel.findOne({ doctorId, addressId, date: slotDate });
    if (!slotDoc) {
      return res.status(404).json({
        status: 'fail',
        message: 'No slots found for the specified doctor, address, and date',
      });
    }

    // Filter out the specified slotTimes
    const initialSlotCount = slotDoc.slots.length;
    const deletedTimes = [];
    slotDoc.slots = slotDoc.slots.filter(slot => {
      if (slotTimes.includes(slot.time)) {
        deletedTimes.push(slot.time);
        return false; // Remove this slot
      }
      return true; // Keep this slot
    });

    // Check if any slots were deleted
    if (deletedTimes.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: `No matching slots found for the specified times: ${slotTimes.join(', ')}`,
        deletedSlots: 0,
        deletedTimes: [],
      });
    }

    // If no slots remain, delete the document
    if (slotDoc.slots.length === 0) {
      await slotDoc.remove();
      return res.status(200).json({
        status: 'success',
        message: `Deleted ${deletedTimes.length} slot(s) for ${date} at address ${addressId} for doctor ${doctorId}, and the slot document was removed as it became empty`,
        deletedSlots: deletedTimes.length,
        deletedTimes,
      });
    }

    // Save the updated document
    await slotDoc.save();

    return res.status(200).json({
      status: 'success',
      message: `Deleted ${deletedTimes.length} slot(s) for ${date} at address ${addressId} for doctor ${doctorId}`,
      deletedSlots: deletedTimes.length,
      deletedTimes,
    });
  } catch (error) {
    console.error('Error deleting slots:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to delete slots',
      error: error.message,
    });
  }
};