const express = require('express');
const router = express.Router();
const {
   
    getSlotsByDoctorIdAndDateForWhatsapp,
    booking,
    createWhatsappAppointment,
    CashfreePaymentLinkDetails,
    cashfreeCallback
} = require('../controllers/whatsappController');



// Duplicate API for WhatsApp integration
router.get('/getSlotsByDoctorIdAndDateForWhatsapp', getSlotsByDoctorIdAndDateForWhatsapp);
router.post('/booking', booking);
router.post('/createWhatsappAppointment', createWhatsappAppointment);
router.post('/CashfreePaymentLinkDetails', CashfreePaymentLinkDetails);// Handle both GET and POST requests for the callback URL
router.get('/cashfreecallback', cashfreeCallback);
router.post('/cashfreecallback', cashfreeCallback);


module.exports = router;