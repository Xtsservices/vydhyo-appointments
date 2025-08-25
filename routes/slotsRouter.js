const express = require('express');
const router = express.Router();
const {
    createSlotsForDoctor,
    getSlotsByDoctorIdAndDate,
    updateDoctorSlots,
    getNextAvailableSlotsByDoctorAndAddress,
    getNextAvailableSlotsByDoctor,
    deleteDoctorSlots,
    getSlotsByDoctorIdAndDateForWhatsapp
} = require('../controllers/slotsController');

router.post('/createSlotsForDoctor', createSlotsForDoctor);
router.get('/getSlotsByDoctorIdAndDate', getSlotsByDoctorIdAndDate);
router.put('/updateDoctorSlots', updateDoctorSlots);
router.get('/getNextAvailableSlotsByDoctorAndAddress', getNextAvailableSlotsByDoctorAndAddress);
router.get('/getNextAvailableSlotsByDoctor', getNextAvailableSlotsByDoctor);
router.delete('/deleteDoctorSlots', deleteDoctorSlots);

// Duplicate API for WhatsApp integration
router.get('/getSlotsByDoctorIdAndDateForWhatsapp', getSlotsByDoctorIdAndDateForWhatsapp);

module.exports = router;