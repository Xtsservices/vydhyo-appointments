const appointmentModel = require('../models/appointmentsModel');
const sequenceSchema = require('../sequence/sequenceSchema');
const appointmentSchema = require('../schemas/appointmentSchema');
const DoctorSlotModel = require('../models/doctorSlotsModel');
const doctorSlotSchema = require('../schemas/doctorSlotsSchema');
const { SEQUENCE_PREFIX } = require('../utils/constants');
const generateSlots = require('../utils/generateTimeSlots');
const { getUserById, getUserDetailsBatch } = require('../services/userService');
const { createPayment, getAppointmentPayments, updatePayment } = require('../services/paymentService');
const moment = require('moment-timezone');
const { parseFlexibleDate } = require('../utils/utils');

exports.createAppointment = async (req, res) => {
  try {
    const { error } = appointmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: 'fail',
        message: error.details[0].message,
      });
    }
    const appointmentDateTime = moment.tz(`${req.body.appointmentDate} ${req.body.appointmentTime}`, 'YYYY-MM-DD HH:mm', 'Asia/Kolkata');
    const now = moment.tz('Asia/Kolkata');

    if (appointmentDateTime.isBefore(now)) {
      return res.status(208).json({
        status: 'fail',
        message: 'Appointment date & time must not be in the past.'
      });
    }

    const checkSlotAvaliable = await appointmentModel.find({
      "doctorId": req.body.doctorId,
      "appointmentDate": new Date(req.body.appointmentDate),
      "appointmentTime": req.body.appointmentTime,
      "appointmentStatus": { $in: ["pending", "scheduled"] }
    });

    if (checkSlotAvaliable.length > 0) {
      return res.status(208).json({
        status: 'fail',
        message: 'Slot already booked for this date and time',
      });
    }
    req.body.createdBy = req.headers ? req.headers.userid : null;
    req.body.updatedBy = req.headers ? req.headers.userid : null;

    const appointmentCounter = await sequenceSchema.findByIdAndUpdate({
      _id: SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.APPOINTMENTS_MODEL
    }, { $inc: { seq: 1 } }, { new: true, upsert: true });

    req.body.appointmentId = SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.SEQUENCE.concat(appointmentCounter.seq);
    const appointment = await appointmentModel.create(req.body);
    let paymentResponse = { status: 'pending' };
    if (req.body.paymentStatus === 'paid') {
      paymentResponse = await createPayment(req.headers.authorization, {
        userId: req.body.userId,
        doctorId: req.body.doctorId,
        appointmentId: req.body.appointmentId,
        actualAmount: req.body.amount,
        discount: req.body.discount || 0,
        discountType: req.body.discountType,
        finalAmount: req.body.finalAmount,
        paymentStatus: 'paid'
      });

      if (!paymentResponse || paymentResponse.status !== 'success') {
        return res.status(500).json({
          status: 'fail',
          message: 'Payment failed, please try again later.',
        });
      }
    }
    const updateAppointment = await appointmentModel.findByIdAndUpdate(
      appointment._id,
      { appointmentStatus: 'scheduled' },
      { new: true }
    );
    if (!appointment) {
      return res.status(404).json({
        status: 'fail',
        message: 'appointment not created',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'appointment created successfully',
      data: {
        appointmentDetails: updateAppointment,
        paymentDetails: paymentResponse.data
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating appointment', error: error.message });
  }
};

//getAllAppointmentCount
exports.getAllAppointments = async (req, res) => {
  try {
    // Fetch all appointments without any filters
    const appointments = await appointmentModel.find({});

    return res.status(200).json({
      status: 'success',
      message: 'Appointments retrieved successfully',
      data: {
        totalAppointmentsCount: appointments.length,
        totalAppointments: appointments,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'fail',
      message: 'Error retrieving appointments',
      error: error.message,
    });
  }
};

exports.createDoctorSlots = async (req, res) => {
  try {
    const { doctorId, date } = req.body;
    const slotDate = new Date(date);
    const existingSlots = await DoctorSlotModel.findOne({ doctorId, date: slotDate });
    if (existingSlots) {
      return res.status(200).json({
        status: 'success',
        message: `Slots already created for this date ${date}`,
        data: existingSlots,
      });
    }
    const userDetails = await getUserById(doctorId, req.headers.authorization);
    console.log('User Details:', userDetails);
    return;
    const slots = generateSlots();
    req.body.slots = slots;
    const { error } = doctorSlotSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: 'fail',
        message: error.details[0].message,
      });
    }
    const newSlots = await DoctorSlotModel.create({ doctorId, date: slotDate, slots });
    if (!newSlots) {
      return res.status(404).json({
        status: 'fail',
        message: 'slots not created',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'slots created successfully',
      data: newSlots,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Slots already created for this doctor and date' });
    }
    res.status(500).json({ error: err.message });
  }
}

exports.getAppointmentsWithPayments = async (req, res) => {
  try {
    const {
      doctorId,
      appointmentType,
      appointmentDepartment,
      appointmentStatus,
      appointmentDate,
      fromDate,
      toDate
    } = req.query;

    if (!doctorId) {
      return res.status(400).json({ status: 'fail', message: "doctorId is required" });
    }

    const query = { doctorId };
    if (appointmentType) query.appointmentType = appointmentType;
    if (appointmentDepartment) query.appointmentDepartment = appointmentDepartment;
    if (appointmentStatus) query.appointmentStatus = appointmentStatus;

    const parsedAppointmentDate = parseFlexibleDate(appointmentDate);
    if (parsedAppointmentDate) {
      query.appointmentDate = parsedAppointmentDate;
    }

    const parsedFromDate = parseFlexibleDate(fromDate);
    const parsedToDate = parseFlexibleDate(toDate);

    if (parsedFromDate || parsedToDate) {
      query.appointmentDate = query.appointmentDate || {};
      if (parsedFromDate) query.appointmentDate.$gte = parsedFromDate;
      if (parsedToDate) {
        // Add one day to make the filter inclusive of the whole toDate day
        parsedToDate.setHours(23, 59, 59, 999);
        query.appointmentDate.$lte = parsedToDate;
      }
    }
    // If no date filters provided, default to today
    if (!appointmentDate && !fromDate && !toDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      query.appointmentDate = { $gte: today, $lt: tomorrow };
    }

    const appointments = await appointmentModel.find(query);
    if (!appointments.length) {
      return res.status(404).json({ status: 'fail', message: "No appointments found" });
    }

    // Prepare user IDs and appointment IDs
    const userIdsSet = new Set();
    const appointmentIds = [];

    appointments.forEach(appt => {
      userIdsSet.add(appt.userId);
      userIdsSet.add(appt.doctorId);
      appointmentIds.push(appt.appointmentId.toString());
    });

    const allUserIds = Array.from(userIdsSet);
    const authHeader = req.headers.authorization;

    // Call external services in parallel
    const [users, paymentResp] = await Promise.all([
      getUserDetailsBatch(authHeader, { userIds: allUserIds }),
      getAppointmentPayments(authHeader, { appointmentIds })
    ]);

    const userMap = new Map(users.map(user => [user.userId, user]));
    const paymentMap = new Map(paymentResp.payments.map(payment => [payment.appointmentId, payment]));

    // Construct response
    const result = appointments.map(appt => ({
      ...appt.toObject(),
      patientDetails: userMap.get(appt.userId) || null,
      doctorDetails: userMap.get(appt.doctorId) || null,
      paymentDetails: paymentMap.get(appt.appointmentId.toString()) || null
    }));

    res.json({ status: "success", data: result });

  } catch (err) {
    console.error('Error in getAppointmentsWithPayments:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

async function bookSlot(doctorId, date, time, appointmentId) {
  const result = await DoctorSlotModel.updateOne(
    { doctorId, date, "slots.time": time, "slots.status": "available" },
    {
      $set: {
        "slots.$.status": "booked",
        "slots.$.appointmentId": appointmentId
      }
    }
  );

  if (result.modifiedCount === 0) {
    throw new Error('Slot already booked or does not exist');
  }
}

async function cancelSlot(doctorId, date, time) {
  await DoctorSlotModel.updateOne(
    { doctorId, date, "slots.time": time },
    {
      $set: {
        "slots.$.status": "available",
        "slots.$.appointmentId": null
      }
    }
  );
}

exports.getAppointmentTypeCounts = async (req, res) => {
  const { doctorId } = req.query;
  const match = {
    appointmentStatus: { $ne: 'cancelled' },
    appointmentType: { $in: ['In-Person', 'Video', 'home-visit'] }
  };
  if (doctorId) {
    match.doctorId = doctorId;
  }
  try {
    const counts = await appointmentModel.aggregate([
      {
        $match: {
          appointmentStatus: { $ne: 'cancelled' },
          appointmentType: { $in: ['In-Person', 'Video', 'home-visit'] }
        }
      },
      {
        $group: {
          _id: '$appointmentType',
          count: { $sum: 1 }
        }
      }
    ]);
    // Format response as { appointmentType: count }
    const result = {
      "In-Person": 0,
      "Video": 0,
      "home-visit": 0
    };
    counts.forEach(item => {
      result[item._id] = item.count;
    });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};

exports.getTodayAndUpcomingAppointmentsCount = async (req, res) => {
  try {
    const { doctorId } = req.query;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(todayEnd);
    tomorrowStart.setDate(todayEnd.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);

    const baseQuery = {};
    if (doctorId) baseQuery.userId = doctorId;


    console.log('--- Dates ---');
console.log({ todayStart, todayEnd, tomorrowStart, doctorId });
    // Date-based counts
    const todayQuery = {
      ...baseQuery,
      appointmentDate: { $gte: todayStart, $lte: todayEnd }
    };
    const upcomingQuery = {
      ...baseQuery,
      appointmentDate: { $gte: tomorrowStart }
    };

    // Status-based counts (all dates)
    const completedQuery = { ...baseQuery, appointmentStatus: 'completed' };
    const rescheduledQuery = { ...baseQuery, appointmentStatus: 'rescheduled' };
    const scheduledQuery = { ...baseQuery, appointmentStatus: 'scheduled' };
    const cancelledQuery = { ...baseQuery, appointmentStatus: 'cancelled' };
    const activeQuery = { ...baseQuery, appointmentStatus: { $nin: ['cancelled', 'completed'] } };
    const totalQuery = { ...baseQuery };

    const [
      today,
      upcoming,
      completed,
      rescheduled,
      scheduled,
      cancelled,
      active,
      total
    ] = await Promise.all([
      appointmentModel.countDocuments(todayQuery),
      appointmentModel.countDocuments(upcomingQuery),
      appointmentModel.countDocuments(completedQuery),
      appointmentModel.countDocuments(rescheduledQuery),
      appointmentModel.countDocuments(scheduledQuery),
      appointmentModel.countDocuments(cancelledQuery),
      appointmentModel.countDocuments(activeQuery),
      appointmentModel.countDocuments(totalQuery)
    ]);

    res.json({
      status: 'success',
      data: {
        today,
        upcoming,
        completed,
        rescheduled,
        scheduled,
        cancelled,
        active,
        total
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

exports.getUniquePatientsStats = async (req, res) => {
  try {
    const { doctorId } = req.query;
    if (!doctorId) {
      return res.status(400).json({ status: 'fail', message: 'doctorId is required' });
    }
    const now = new Date();
    // Today
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    // This week (Monday to Sunday)
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    // This month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Helper for aggregation
    const uniquePatients = async (match) => {
      const result = await appointmentModel.aggregate([
        { $match: match },
        { $group: { _id: '$userId' } },
        { $count: 'count' }
      ]);
      return result[0]?.count || 0;
    };
    const baseMatch = { doctorId, appointmentStatus: { $ne: 'cancelled' } };
    const [
      total,
      today,
      week,
      month
    ] = await Promise.all([
      uniquePatients(baseMatch),
      uniquePatients({ ...baseMatch, appointmentDate: { $gte: todayStart, $lte: todayEnd } }),
      uniquePatients({ ...baseMatch, appointmentDate: { $gte: weekStart, $lte: weekEnd } }),
      uniquePatients({ ...baseMatch, appointmentDate: { $gte: monthStart, $lte: monthEnd } })
    ]);
    res.json({
      status: 'success',
      data: {
        total,
        today,
        week,
        month
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

exports.getTopDoctorsByAppointmentCount = async (req, res) => {
  try {
    const topDoctors = await appointmentModel.aggregate([
      { $match: { appointmentStatus: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$doctorId',
          count: { $sum: 1 },
          doctorName: { $first: '$doctorName' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $project: {
          doctorId: '$_id',
          doctorName: 1,
          count: 1,
          _id: 0
        }
      }
    ]);
    res.json({ status: 'success', data: topDoctors });
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

exports.cancelAppointment = async (req, res) => {
  const { appointmentId, reason } = req.body;
  if (!appointmentId) {
    return res.status(400).json({ status: 'fail', message: "appointmentId is required" });
  }
  if (!reason) {
    return res.status(400).json({ status: 'fail', message: "Cancellation reason is required" });
  }

  try {
    const appointment = await appointmentModel.findOne({ "appointmentId": appointmentId });
    if (!appointment) {
      return res.status(404).json({ status: 'fail', message: "Appointment not found" });
    }

    // Only cancel if not already cancelled or completed
    if (['cancelled', 'completed'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({ status: 'fail', message: `Cannot cancel appointment already marked as ${appointment.appointmentStatus}` });
    }

    // Can uncomment this block if you want to prevent cancellation of past appointments
    // const appointmentDateTime = moment.tz(
    //   `${moment(appointment.appointmentDate).format('YYYY-MM-DD')} ${appointment.appointmentTime}`,
    //   'YYYY-MM-DD HH:mm',
    //   'Asia/Kolkata'
    // );
    // if (appointmentDateTime.isSameOrBefore(moment.tz('Asia/Kolkata'))) {
    //   return res.status(400).json({
    //     status: 'fail',
    //     message: 'Cannot cancel past appointments'
    //   });
    // }

    // Fetch associated payment
    const payment = await updatePayment(req.headers.authorization, {
      appointmentId: appointment.appointmentId,
      status: 'refund_pending'
    });

    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { "appointmentId": appointmentId },
      {
        $set: {
          appointmentStatus: 'cancelled',
          cancellationReason: reason,
          updatedBy: req.headers ? req.headers.userid : '',
          updatedAt: new Date()
        }
      },
      { new: true }
    );
    if (!updateAppointment) {
      return res.status(404).json({ status: 'fail', message: "Failed to cancel appointment" });
    }
    return res.status(200).json({
      status: 'success',
      message: 'Appointment cancelled successfully',
      appointmentDetails: appointment,
      paymentDetails: payment.data || null
    });

  } catch (err) {
    console.error("Cancel Appointment Error:", err);
    return res.status(500).json({ status: 'fail', message: 'Internal server error' });
  }
};

exports.rescheduleAppointment = async (req, res) => {
  const { appointmentId, newDate, newTime, reason } = req.body;
  if (!appointmentId || !newDate || !newTime) {
    return res.status(400).json({ status: 'fail', message: "appointmentId, newDate and newTime are required" });
  }
  const rescheduleDateTime = moment.tz(
    `${moment(newDate).format('YYYY-MM-DD')} ${newTime}`,
    'YYYY-MM-DD HH:mm',
    'Asia/Kolkata'
  );
  if (rescheduleDateTime.isSameOrBefore(moment.tz('Asia/Kolkata'))) {
    return res.status(400).json({
      status: 'fail',
      message: 'Cannot reschedule past date and time'
    });
  }

  try {
    const appointment = await appointmentModel.findOne({ "appointmentId": appointmentId });
    if (!appointment) {
      return res.status(404).json({ status: 'fail', message: "Appointment not found" });
    }

    // Only reschedule if not already cancelled or completed
    if (['cancelled', 'completed'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({ status: 'fail', message: `Cannot reschedule appointment already marked as ${appointment.appointmentStatus}` });
    }

    // Can uncomment this block if you want to prevent rescheduling of past appointments
    // const appointmentDateTime = moment.tz(
    //   `${moment(appointment.appointmentDate).format('YYYY-MM-DD')} ${appointment.appointmentTime}`,
    //   'YYYY-MM-DD HH:mm',
    //   'Asia/Kolkata'
    // );
    // if (appointmentDateTime.isSameOrBefore(moment.tz('Asia/Kolkata'))) {
    //   return res.status(400).json({
    //     status: 'fail',
    //     message: 'Cannot reschedule past appointments'
    //   });
    // }

    // Check if the new slot is available
    const checkSlotAvailable = await appointmentModel.find({
      "doctorId": appointment.doctorId,
      "appointmentDate": new Date(newDate),
      "appointmentTime": newTime,
      "appointmentStatus": { $in: ["pending", "scheduled"] }
    });

    if (checkSlotAvailable.length > 0) {
      return res.status(208).json({
        status: 'fail',
        message: 'Slot already booked for this date and time',
      });
    }

    // Update the appointment with the new date and time
    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { "appointmentId": appointmentId },
      {
        $set: {
          appointmentDate: new Date(newDate),
          appointmentTime: newTime,
          updatedBy: req.headers ? req.headers.userid : '',
          updatedAt: new Date()
        },
        $push: {
          rescheduleHistory: {
            previousDate: appointment.appointmentDate,
            previousTime: appointment.appointmentTime,
            rescheduledDate: new Date(newDate),
            rescheduledTime: newTime,
            reason: reason || null,
          }
        }
      },
      { new: true }
    );
    if (!updateAppointment) {
      return res.status(404).json({ status: 'fail', message: "Failed to reschedule appointment" });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Appointment rescheduled successfully',
      appointmentDetails: updateAppointment
    });
  }
  catch (err) {
    console.error("Reschedule Appointment Error:", err);
    return res.status(500).json({ status: 'fail', message: 'Internal server error' });
  }
}

exports.completeAppointment = async (req, res) => {
  const { appointmentId, appointmentNotes = '' } = req.body;
  if (!appointmentId) {
    return res.status(400).json({ status: 'fail', message: "appointmentId is required" });
  }

  try {
    const appointment = await appointmentModel.findOne({ "appointmentId": appointmentId });
    if (!appointment) {
      return res.status(404).json({ status: 'fail', message: "Appointment not found" });
    }

    // Only complete if not already cancelled or completed
    if (['cancelled', 'completed'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({ status: 'fail', message: `Cannot complete appointment already marked as ${appointment.appointmentStatus}` });
    }

    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { "appointmentId": appointmentId },
      {
        $set: {
          appointmentStatus: 'completed',
          appointmentNotes: appointmentNotes,
          updatedBy: req.headers ? req.headers.userid : '',
          updatedAt: new Date()
        }
      },
      { new: true }
    );
    if (!updateAppointment) {
      return res.status(404).json({ status: 'fail', message: "Failed to complete appointment" });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Appointment completed successfully',
      appointmentDetails: updateAppointment
    });

  } catch (err) {
    console.error("Complete Appointment Error:", err);
    return res.status(500).json({ status: 'fail', message: 'Internal server error' });
  }
}

exports.updateAppointmentById = async (req, res) => {
  const { appointmentId, ...updateData } = req.body;

  if (!appointmentId) {
    return res.status(400).json({ status: 'fail', message: "appointmentId is required" });
  }

  // Allowed fields for normal updates
  const allowedFields = [
    "appointmentReason",
    "appointmentNotes"
  ];

  try {
    const appointment = await appointmentModel.findOne({ appointmentId });
    if (!appointment) {
      return res.status(404).json({ status: 'fail', message: "Appointment not found" });
    }

    let filteredUpdateData = {};

    const allowedIfFinal = ["appointmentNotes", "appointmentReason"];

    for (const key of allowedIfFinal) {
      if (key in updateData) {
        filteredUpdateData[key] = updateData[key];
      }
    }

    // If trying to update other fields → block
    const extraKeys = Object.keys(updateData).filter(k => !allowedIfFinal.includes(k));
    if (extraKeys.length > 0) {
      return res.status(400).json({
        status: 'fail',
        message: `Cannot update fields ${extraKeys.join(', ')} for a ${appointment.appointmentStatus} appointment`
      });
    }

    const updatedAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId },
      {
        $set: {
          ...filteredUpdateData,
          updatedBy: req.headers?.userid || '',
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    if (!updatedAppointment) {
      return res.status(404).json({ status: 'fail', message: "Failed to update appointment" });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Appointment updated successfully',
      appointmentDetails: updatedAppointment
    });

  } catch (err) {
    return res.status(500).json({ status: 'fail', message: `Internal server error: ${err.message}` });
  }
};
