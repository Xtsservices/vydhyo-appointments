const express = require('express');
const router = express.Router();
const {
  createAppointment,
  createDoctorSlots,
  getAppointmentsWithPayments,
  getAllAppointments,
  getAppointmentTypeCounts,
  getTodayAndUpcomingAppointmentsCount,
  getUniquePatientsStats,
  getTopDoctorsByAppointmentCount,
  cancelAppointment,
  rescheduleAppointment,
  updateAppointmentById,
  completeAppointment,
  getTodayAppointmentCount,
  getAppointmentsByDoctorID,
  getAppointmentsCountByDoctorID,
  getAppointment,
  getAppointmentsByDoctor
} = require('../controllers/appointmentsController');

router.post('/createAppointment', createAppointment);
router.get('/getAppointments', getAppointmentsWithPayments);
router.get('/getAllAppointments', getAllAppointments);
router.get('/getAppointmentTypeCounts', getAppointmentTypeCounts);
router.get('/getTodayAndUpcomingAppointmentsCount', getTodayAndUpcomingAppointmentsCount);

router.get('/getUniquePatientsStats', getUniquePatientsStats);
router.get('/getTopDoctorsByAppointmentCount', getTopDoctorsByAppointmentCount);

router.post('/cancelAppointment', cancelAppointment);
router.post('/rescheduleAppointment', rescheduleAppointment);
router.post('/completeAppointment', completeAppointment);
router.post('/updateAppointmentById', updateAppointmentById);

router.get('/getTodayAppointmentCount', getTodayAppointmentCount);
router.get('/getAppointmentsByDoctorID/:type', getAppointmentsByDoctorID);
router.get('/getAppointmentsCountByDoctorID', getAppointmentsCountByDoctorID);

router.get('/getAppointment', getAppointment);
router.get('/getAppointmentsByDoctor/:doctorId', getAppointmentsByDoctor);


module.exports = router;