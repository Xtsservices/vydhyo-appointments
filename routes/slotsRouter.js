const express = require('express');
const router = express.Router();
const {
    createSlotsForDoctor,
    getSlotsByDoctorIdAndDate,
    updateDoctorSlots
} = require('../controllers/slotsController');

router.post('/createSlotsForDoctor', createSlotsForDoctor);
router.get('/getSlotsByDoctorIdAndDate', getSlotsByDoctorIdAndDate);
router.put('/updateDoctorSlots', updateDoctorSlots);


module.exports = router;