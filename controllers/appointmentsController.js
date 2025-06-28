const appointmentModel = require('../models/appointmentsModel');
const sequenceSchema = require('../sequence/sequenceSchema');
const appointmentSchema = require('../schemas/appointmentSchema');
const DoctorSlotModel = require('../models/doctorSlotsModel');
const doctorSlotSchema = require('../schemas/doctorSlotsSchema');
const { SEQUENCE_PREFIX } = require('../utils/constants');
const generateSlots = require('../utils/generateTimeSlots');
const { getUserById, getUserDetailsBatch } = require('../services/userService');
const { createPayment, getAppointmentPayments } = require('../services/paymentService');
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
        paymentStatus: 'success'
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
    if (doctorId) baseQuery.doctorId = doctorId;

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
    const cancelledQuery = { ...baseQuery, appointmentStatus: 'cancelled' };
    const activeQuery = { ...baseQuery, appointmentStatus: { $nin: ['cancelled', 'completed'] } };
    const totalQuery = { ...baseQuery };

    const [
      today,
      upcoming,
      completed,
      rescheduled,
      cancelled,
      active,
      total
    ] = await Promise.all([
      appointmentModel.countDocuments(todayQuery),
      appointmentModel.countDocuments(upcomingQuery),
      appointmentModel.countDocuments(completedQuery),
      appointmentModel.countDocuments(rescheduledQuery),
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

