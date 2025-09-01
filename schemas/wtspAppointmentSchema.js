const Joi = require("joi");

const wtspAppointmentSchema = Joi.object({
  doctorId: Joi.string().required(),
  addressId: Joi.string().required(),
  appointmentType: Joi.string().required(),
  appointmentDepartment: Joi.string().required(),
  appointmentDate: Joi.date().required(),
  appointmentReason: Joi.string().required(),
  paymentStatus: Joi.string().valid("paid", "unpaid").required(),
  appSource: Joi.string().valid("patientApp", "walkIn", "whatsapp").required(),
  amount: Joi.number().min(0).required(),
  discount: Joi.number().min(0).default(0),
  mobile: Joi.string().required(),
  appointmentTime: Joi.string()
    .required()
    .pattern(/^([0-1]\d|2[0-3]):([0-5]\d)$/)
    .message("appointmentTime must be in HH:mm format"),

  doctorName: Joi.string().allow(null, ""),
  patientName: Joi.string().allow(null, ""),
  appointmentStatus: Joi.string()
    .valid("scheduled", "completed", "cancelled", "pending", "rescheduled")
    .default("pending"),
  appointmentNotes: Joi.string().allow(null, "").optional(),
  discountType: Joi.string().valid("percentage", "flat").default("flat"),
  referralCode: Joi.string().allow(null, "").optional(),
  paymentMethod: Joi.string().allow(null, "").optional(),
  homeAddress: Joi.string().allow(null, "").optional(),
});

module.exports = wtspAppointmentSchema;
