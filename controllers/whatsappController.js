const DoctorSlotModel = require('../models/doctorSlotsModel');
const doctorSlotSchema = require('../schemas/doctorSlotsSchema');
const generateSlots = require('../utils/generateTimeSlots');
const { sortSlotsByTime } = require('../utils/utils');
const Joi = require('joi');
const axios = require('axios');



// Duplicate API for WhatsApp integration
exports.getSlotsByDoctorIdAndDateForWhatsapp = async (req, res) => {
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
