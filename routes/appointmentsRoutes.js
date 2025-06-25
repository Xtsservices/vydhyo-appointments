const express = require('express');
const router = express.Router();
const { createAppointment, createDoctorSlots, getAppointmentsWithPayments, getAllAppointments,getAppointmentTypeCounts,getTodayAndUpcomingAppointmentsCount,getUniquePatientsStats } = require('../controllers/appointmentsController');

router.post('/createAppointment', createAppointment);
router.post('/createDoctorSlots', createDoctorSlots);
router.get('/getAppointments', getAppointmentsWithPayments);
router.get('/getAllAppointments', getAllAppointments);
router.get('/getAppointmentTypeCounts', getAppointmentTypeCounts);
router.get('/getTodayAndUpcomingAppointmentsCount', getTodayAndUpcomingAppointmentsCount);

router.get('/getUniquePatientsStats', getUniquePatientsStats);

module.exports = router;