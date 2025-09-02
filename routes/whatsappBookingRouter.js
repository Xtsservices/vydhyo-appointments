const express = require('express');
const router = express.Router();
const {
   
    getSlotsByDoctorIdAndDateForWhatsapp,
    booking,
    createWhatsappAppointment,
    CashfreePaymentLinkDetails
} = require('../controllers/whatsappController');



// Duplicate API for WhatsApp integration
router.get('/getSlotsByDoctorIdAndDateForWhatsapp', getSlotsByDoctorIdAndDateForWhatsapp);
router.post('/booking', booking);
router.post('/createWhatsappAppointment', createWhatsappAppointment);
router.post('/CashfreePaymentLinkDetails', CashfreePaymentLinkDetails);


module.exports = router;