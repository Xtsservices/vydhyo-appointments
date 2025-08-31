const express = require('express');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
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
  getAppointmentsByDoctor,
  getAllFamilyAppointments,
  getAppointmentDataByUserIdAndDoctorId,
  getAllFamilyDoctors,
  updateAppointmentStatus,
  releaseDoctorSlot
} = require('../controllers/appointmentsController');

// router.post('/createAppointment', createAppointment);
router.post('/createAppointment',upload.single('medicalReport'), createAppointment);

//After sdk Payment success
router.post('/updateAppointmentStatus', updateAppointmentStatus);
//after payment failure
router.post('/releaseDoctorSlot', releaseDoctorSlot);
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
router.get('/getAllFamilyAppointments/:userId', getAllFamilyAppointments);

router.get("/getAppointmentDataByUserIdAndDoctorId", getAppointmentDataByUserIdAndDoctorId);

//patient app
router.get('/getAllFamilyDoctors', getAllFamilyDoctors);

module.exports = router;