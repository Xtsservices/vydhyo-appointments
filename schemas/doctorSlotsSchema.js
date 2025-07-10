const Joi = require('joi');

// Slot schema
const slotSchema = Joi.object({
  time: Joi.string()
    .pattern(/^([0-1]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({
      'string.pattern.base': 'Time must be in HH:MM 24-hour format',
    }),
  status: Joi.string()
    .valid('available', 'booked', 'blocked')
    .default('available'),
  appointmentId: Joi.string().allow(null).optional(),
  updatedBy: Joi.string().required(),
  updatedAt: Joi.date().allow(null).optional(),
});

// DoctorSlot schema
const doctorSlotSchema = Joi.object({
  doctorId: Joi.string().required().messages({
    'any.required': 'doctorId is required',
  }),
  addressId: Joi.string().required().messages({
    'any.required': 'addressId is required',
  }),
  date: Joi.date().required().messages({
    'any.required': 'date is required',
    'date.base': 'date must be a valid date',
  }),
  slots: Joi.array().items(slotSchema).required().messages({
    'any.required': 'slots are required',
    'array.base': 'slots must be an array of slot objects'
  })
});

module.exports = doctorSlotSchema;
