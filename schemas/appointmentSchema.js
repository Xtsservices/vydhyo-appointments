const Joi = require('joi');

const appointmentSchema = Joi.object({
    userId: Joi.string().required(),
    doctorId: Joi.string().required(),
    addressId: Joi.string().required(),
    patientName: Joi.string().allow(null, ''),
    doctorName: Joi.string().allow(null, ''),
    appointmentType: Joi.string().required(),
    appointmentDepartment: Joi.string().required(),
    appointmentDate: Joi.date().required(),
    appointmentTime: Joi.string()
        .required()
        .pattern(/^([0-1]\d|2[0-3]):([0-5]\d)$/)
        .message('appointmentTime must be in HH:mm format'),
    appointmentReason: Joi.string().required(),
    appointmentStatus: Joi.string()
        .valid('scheduled', 'completed', 'cancelled', 'rescheduled')
        .default('scheduled'),
    appointmentNotes: Joi.string().allow(null, '').optional(),
    paymentStatus: Joi.string()
        .valid('paid', 'unpaid')
        .required(),
    amount: Joi.number().min(0).required(),
    discount: Joi.number().min(0).default(0),
    discountType: Joi.string().valid('percentage', 'flat').default('flat')
});

module.exports = appointmentSchema;
