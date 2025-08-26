const express = require('express');
const router = express.Router();
const {
   
    getSlotsByDoctorIdAndDateForWhatsapp
} = require('../controllers/whatsappController');



// Duplicate API for WhatsApp integration
router.get('/getSlotsByDoctorIdAndDateForWhatsapp', getSlotsByDoctorIdAndDateForWhatsapp);

module.exports = router;