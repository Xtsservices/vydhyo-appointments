const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  time: { type: String, required: true },
  status: {
    type: String,
    enum: ['available', 'unavailable', 'booked', 'blocked'],
    default: 'available'
  },
  appointmentId: { type: String, default: null },
  updatedBy: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const doctorSlotSchema = new mongoose.Schema({
  doctorId: { type: String, required: true },
  addressId: { type: String, required: true },
  date: { type: Date, required: true },
  slots: [slotSchema],
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

doctorSlotSchema.index({ doctorId: 1, addressId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DoctorSlot', doctorSlotSchema);
