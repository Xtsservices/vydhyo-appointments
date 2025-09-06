const cron = require('node-cron');
const moment = require("moment");
const mongoose = require('mongoose');
const appointmentsModel = require('../models/appointmentsModel');
const { creditReferralReward } = require('../services/referralService');
const { REWARD_AMOUNT } = require('../utils/fees');
const { getUsersByIds } = require('../services/userService');
const { sendOTPSMS } = require('../utils/sms');

// Function to mark appointments as completed if older than 48 hours
const autoCompleteAppointments = async () => {
  try {
    console.log('Running auto-complete appointments cron job...');

    // Current time
    const now = new Date();
    // 48 hours ago
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    // Query appointments that are:
    // - Not completed or cancelled
    // - Scheduled more than 48 hours ago
    const appointments = await appointmentsModel.find({
      appointmentStatus: { $nin: ['completed', 'cancelled'] },
      $expr: {
        $lt: [
          {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } },
                  'T',
                  '$appointmentTime',
                  ':00'
                ]
              },
              timezone: 'Asia/Kolkata'
            }
          },
          fortyEightHoursAgo
        ]
      }
    });

    if (appointments.length === 0) {
      console.log('No appointments found to auto-complete.');
      return;
    }

    console.log(`Found ${appointments.length} appointments to auto-complete.`);

    // Update each appointment to completed
    for (const appointment of appointments) {
     const updatedAppointment =  await appointmentsModel.findOneAndUpdate(
        { appointmentId: appointment.appointmentId },
        {
          $set: {
            appointmentStatus: 'completed',
            appointmentNotes: appointment.appointmentNotes
              ? `${appointment.appointmentNotes}\nAuto-completed by system on ${new Date().toISOString()}`
              : `Auto-completed by system on ${new Date().toISOString()}`,
            updatedAt: new Date(),
            updatedBy: 'system' // You can set a specific system identifier if needed
          }
        },
        { new: true }
      );
      console.log(`Auto-completed appointment ${appointment.appointmentId}`);
      // Credit referral reward if referralCode exists
      if (updatedAppointment.referralCode) {
        // const REWARD_AMOUNT = 100;
        try {
          await creditReferralReward(updatedAppointment, REWARD_AMOUNT);
          console.log(`Referral reward credited for appointment ${appointment.appointmentId}`);
        } catch (error) {
          console.error(`Failed to credit referral reward for appointment ${appointment.appointmentId}: ${error.message}`);
        }
      }
    }

    console.log('Auto-complete appointments cron job completed successfully.');
  } catch (err) {
    console.error('Error in autoCompleteAppointments cron job:', err);
  }
};



 //Send Appointment Reminders (1 hour before)
const sendAppointmentReminders = async () => {
  try {

    const now = moment();
    const oneHourLater = moment().add(1, "hour");

    // Fetch only appointments in the next hour
    const appointments = await appointmentsModel.find({
      appointmentStatus: "scheduled",
      reminderSent: false,
      $expr: {
        $and: [
          {
            $gte: [
              {
                $dateFromString: {
                  dateString: {
                    $concat: [
                      { $dateToString: { format: "%Y-%m-%d", date: "$appointmentDate" } },
                      "T",
                      "$appointmentTime",
                      ":00"
                    ]
                  },
                  timezone: "Asia/Kolkata"
                }
              },
              now.toDate()
            ]
          },
          {
            $lte: [
              {
                $dateFromString: {
                  dateString: {
                    $concat: [
                      { $dateToString: { format: "%Y-%m-%d", date: "$appointmentDate" } },
                      "T",
                      "$appointmentTime",
                      ":00"
                    ]
                  },
                  timezone: "Asia/Kolkata"
                }
              },
              oneHourLater.toDate()
            ]
          }
        ]
      }
    });


    if (appointments.length === 0) {
      console.log("No appointments found for reminders.");
      return;
    }

    for (const appointment of appointments) {
      const apptDateTime = moment(
        `${moment(appointment.appointmentDate).format("YYYY-MM-DD")} ${appointment.appointmentTime}`,
        "YYYY-MM-DD HH:mm"
      );

      const diffMinutes = apptDateTime.diff(now, "minutes");

      if (diffMinutes >= 55 && diffMinutes <= 65) {
        const users = await getUsersByIds([appointment.doctorId, appointment.userId]);
        const doctor = users[appointment.doctorId];
        const patient = users[appointment.userId];

        if (!patient?.mobile) {
          console.warn(`No mobile found for patient ${appointment.userId}`);
          continue;
        }

        const doctorName = `${doctor?.firstname || ""} ${doctor?.lastname || ""}`.trim();
        const date = moment(appointment.appointmentDate).format("DD-MM-YYYY");
        const time = appointment.appointmentTime;

        const message = `Reminder: Your appointment with Dr. ${doctorName} is scheduled for ${date} at ${time}. Kindly reach 10 mins early. - VYDHYO`;

        const templateId = process.env.APPOINTMENT_REMINDER_TEMPLATE_ID || "1707175447288977953";
        await sendOTPSMS(patient.mobile, message, templateId);

        await appointmentsModel.updateOne(
          { appointmentId: appointment.appointmentId },
          { $set: { reminderSent: true, updatedAt: new Date(), updatedBy: "system" } }
        );

      }
    }

    console.log("Appointment reminder cron job completed successfully.");
  } catch (err) {
    console.error("Error in sendAppointmentReminders cron job:", err);
  }
};



/**
 * Cron Schedulers
 */
// Auto-complete every hour
cron.schedule('0 * * * *', autoCompleteAppointments, {
  scheduled: true,
  timezone: 'Asia/Kolkata' // Adjust to your timezone (IST in this case)
});

// Reminders every 5 minutes
cron.schedule("*/5 * * * *", sendAppointmentReminders, {
  scheduled: true,
  timezone: "Asia/Kolkata",
});

module.exports = { autoCompleteAppointments, sendAppointmentReminders };