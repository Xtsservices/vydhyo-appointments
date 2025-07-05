const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  time: { type: String, required: true },
  status: {
    type: String,
    enum: ['available', 'unavailable', 'booked', 'blocked'],
    default: 'available'
  },
  appointmentId: { type: String, default: null }
});

const doctorSlotSchema = new mongoose.Schema({
  doctorId: { type: String, required: true },
  date: { type: Date, required: true },
  slots: [slotSchema]
});

doctorSlotSchema.index({ doctorId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DoctorSlot', doctorSlotSchema);
