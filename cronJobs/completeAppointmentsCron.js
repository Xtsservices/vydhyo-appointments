const cron = require('node-cron');
const mongoose = require('mongoose');
const appointmentsModel = require('../models/appointmentsModel');
const { creditReferralReward } = require('../services/referralService');
const { REWARD_AMOUNT } = require('../utils/fees');

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

// Schedule the cron job to run every hour
cron.schedule('0 * * * *', autoCompleteAppointments, {
  scheduled: true,
  timezone: 'Asia/Kolkata' // Adjust to your timezone (IST in this case)
});

module.exports = { autoCompleteAppointments };