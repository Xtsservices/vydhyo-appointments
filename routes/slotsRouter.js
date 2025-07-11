const express = require('express');
const router = express.Router();
const {
    createSlotsForDoctor,
    getSlotsByDoctorIdAndDate,
    updateDoctorSlots,
    getNextAvailableSlotsByDoctorAndAddress
} = require('../controllers/slotsController');

router.post('/createSlotsForDoctor', createSlotsForDoctor);
router.get('/getSlotsByDoctorIdAndDate', getSlotsByDoctorIdAndDate);
router.put('/updateDoctorSlots', updateDoctorSlots);
router.get('/getNextAvailableSlotsByDoctorAndAddress', getNextAvailableSlotsByDoctorAndAddress);


module.exports = router;