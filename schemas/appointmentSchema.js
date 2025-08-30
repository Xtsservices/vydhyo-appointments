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
        .valid('scheduled', 'completed', 'cancelled','pending', 'rescheduled')
        .default('pending'),
    appointmentNotes: Joi.string().allow(null, '').optional(),
    paymentStatus: Joi.string()
        .valid('paid', 'unpaid')
        .required(),
         appSource: Joi.string()
  .valid('patientApp', 'walkIn')
  .required(),
    amount: Joi.number().min(0).required(),
    discount: Joi.number().min(0).default(0),
    discountType: Joi.string().valid('percentage', 'flat').default('flat'),
    referralCode: Joi.string().allow(null, '').optional(),
    
    medicalReport: Joi.string().allow(null, '').optional(),

    homeAddress: Joi.object({
        building: Joi.string().required(),
        floorFlat: Joi.string().required(),
        street: Joi.string().required(),
        landmark: Joi.string().allow(null, ''),
        cityState: Joi.string().required(),
        pincode: Joi.string().required(),
    }).optional(),
});

module.exports = appointmentSchema;
