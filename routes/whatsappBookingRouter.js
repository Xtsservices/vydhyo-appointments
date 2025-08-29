const express = require('express');
const router = express.Router();
const {
   
    getSlotsByDoctorIdAndDateForWhatsapp,
    booking
} = require('../controllers/whatsappController');



// Duplicate API for WhatsApp integration
router.get('/getSlotsByDoctorIdAndDateForWhatsapp', getSlotsByDoctorIdAndDateForWhatsapp);
router.post('/booking', booking);

module.exports = router;