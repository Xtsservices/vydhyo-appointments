const express = require('express');
const router = express.Router();
const {
    createSlotsForDoctor,
    getSlotsByDoctorIdAndDate,
    updateDoctorSlots,
    getNextAvailableSlotsByDoctorAndAddress,
    getNextAvailableSlotsByDoctor,
    deleteDoctorSlots
} = require('../controllers/slotsController');

router.post('/createSlotsForDoctor', createSlotsForDoctor);
router.get('/getSlotsByDoctorIdAndDate', getSlotsByDoctorIdAndDate);
router.put('/updateDoctorSlots', updateDoctorSlots);
router.get('/getNextAvailableSlotsByDoctorAndAddress', getNextAvailableSlotsByDoctorAndAddress);
router.get('/getNextAvailableSlotsByDoctor', getNextAvailableSlotsByDoctor);
router.delete('/deleteDoctorSlots', deleteDoctorSlots);

module.exports = router;