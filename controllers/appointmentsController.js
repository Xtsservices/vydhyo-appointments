const mongoose = require("mongoose");
const appointmentModel = require("../models/appointmentsModel");
const sequenceSchema = require("../sequence/sequenceSchema");
const appointmentSchema = require("../schemas/appointmentSchema");
const DoctorSlotModel = require("../models/doctorSlotsModel");
const UserModel = require("../models/usersModel");
const { SEQUENCE_PREFIX } = require("../utils/constants");
const { getUserDetailsBatch, getUsersByIds, getMinimalUser } = require("../services/userService");
const {
  createPayment,
  getAppointmentPayments,
  updatePayment,
} = require("../services/paymentService");
const moment = require("moment-timezone");
const { parseFlexibleDate } = require("../utils/utils");
const axios = require("axios"); // Add axios for making HTTP requests
const { PLATFORM_FEE, REWARD_AMOUNT } = require("../utils/fees");
const fs = require("fs");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { creditReferralReward } = require("../services/referralService");
const { sendOTPSMS } = require("../utils/sms");
const sendNotification = require("../firebase/sendNotification");

const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const AWS_BUCKET_REGION = process.env.AWS_REGION;
const AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const s3Client = new S3Client({
  region: AWS_BUCKET_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY,
    secretAccessKey: AWS_SECRET_KEY,
  },
});

exports.updateAppointmentStatus = async (req, res) => {
  try {
    const { appointmentId } = req.body;
    console.log("appointmentId", appointmentId);
    // Validate input
    if (!appointmentId) {
      return res.status(400).json({
        status: "fail",
        message: "Appointment ID is required",
      });
    }

    // Update appointment status
    const updatedAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId: appointmentId }, // match your custom appointmentId field
      { appointmentStatus: "scheduled" },
      { new: true }
    );

    if (!updatedAppointment) {
      return res.status(404).json({
        status: "fail",
        message: "Appointment not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        appointment: updatedAppointment,
      },
    });
  } catch (error) {
    console.error("Error updating appointment status:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
};

async function cancelSlotAndUpdateAppointmentStatus(appointment, req, reason) {
  const {
    appointmentId,
    doctorId,
    addressId,
    appointmentDate,
    appointmentTime,
  } = appointment;
  if (
    !appointmentId ||
    !doctorId ||
    !addressId ||
    !appointmentDate ||
    !appointmentTime
  ) {
    throw new Error(
      "appointmentId, doctorId, addressId, appointmentDate, appointmentTime are required to cancel a slot"
    );
  }

  // Update DoctorSlotModel to release the slot
  const slotResult = await DoctorSlotModel.updateOne(
    {
      doctorId,
      addressId,
      date: appointmentDate,
    },
    {
      $set: {
        "slots.$[elem].status": "available",
        "slots.$[elem].appointmentId": null,
        "slots.$[elem].updatedBy": req.headers.userid,
        "slots.$[elem].updatedAt": new Date(),
      },
    },
    {
      arrayFilters: [
        {
          "elem.appointmentId": appointmentId,
          "elem.time": appointmentTime,
          "elem.status": { $in: ["booked", "pending", "unavailable"] },
        },
      ],
    }
  );

  // Update appointmentModel to mark appointment as failed
  const appointmentResult = await appointmentModel.updateOne(
    { _id: appointment._id },
    {
      $set: {
        appointmentStatus: "failed",
        cancellationReason: reason || "Failed to complete booking",
        updatedBy: req.headers.userid,
        updatedAt: new Date(),
      },
    }
  );

  console.log("cancelSlotAndUpdateAppointmentStatusResult", {
    slotResult,
    appointmentResult,
    reason,
  });
  return { slotResult, appointmentResult };
}

//original
exports.createAppointment0 = async (req, res) => {
  try {
    // Step 1: Validate Input
    const { error } = appointmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: "fail",
        message: error.details[0].message,
      });
    }

    // Step 2: Check appointment time validity
    const appointmentDateTime = moment.tz(
      `${req.body.appointmentDate} ${req.body.appointmentTime}`,
      "YYYY-MM-DD HH:mm",
      "Asia/Kolkata"
    );
    const now = moment.tz("Asia/Kolkata");

    if (appointmentDateTime.isBefore(now)) {
      return res.status(208).json({
        status: "fail",
        message: "Appointment date & time must not be in the past.",
      });
    }

    // Step 3: Check if slot is already booked
    const checkSlotAvailable = await appointmentModel.find({
      doctorId: req.body.doctorId,
      appointmentDate: new Date(req.body.appointmentDate),
      appointmentTime: req.body.appointmentTime,
      appointmentStatus: { $in: ["pending", "scheduled"] },
    });
    // const checkSlotAvailability = await findSlotByDateTime(req.body.doctorId, req.body.appointmentDate, req.body.appointmentTime);

    if (checkSlotAvailable.length > 0) {
      return res.status(208).json({
        status: "fail",
        message: "Slot already booked or unavailable for this date and time",
      });
    }

    // Step 4: Generate appointmentId first (before calling payment API)
    const appointmentCounter = await sequenceSchema.findByIdAndUpdate(
      { _id: SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.APPOINTMENTS_MODEL },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // Step 5: Create appointment
    req.body.appointmentId =
      SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.SEQUENCE.concat(
        appointmentCounter.seq
      );
    req.body.createdBy = req.headers?.userid || null;
    req.body.updatedBy = req.headers?.userid || null;

    // ✅ Step 5: Handle optional medicalReport (upload to S3)

    if (req.file) {
      const fileExt = path.extname(req.file.originalname);
      const s3Key = `medicalReports/${
        req.body.appointmentId
      }_${Date.now()}${fileExt}`;

      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer, // ✅ use buffer, not fs.readFileSync
        ContentType: req.file.mimetype,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));

      // Construct public URL (if your bucket is public, otherwise you need signed URLs)
      req.body.medicalReport = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    }

    // step 5.1: Check if the doctor has slots available for the appointment date and time
    req.body.referralCode = req.body.referralCode || null;
     // step 5.1: Check if the doctor has slots available for the appointment date and time

    const bookingResult = await bookSlot(req);
    if (!bookingResult || bookingResult.modifiedCount === 0) {
      return res.status(404).json({
        status: "fail",
        message:
          "Slot already booked or slots do not exist check in slot availability.",
      });
    }
    const appointment = await appointmentModel.create(req.body);

    // Step 6: Call payment API (with newly created appointmentId)
   
    let updatedAppointment;
    if (req.body.appSource === 'patientApp' && req.body.paymentMethod === 'wallet') {
      try {
        const finalAmount = req.body.finalAmount || req.body.amount;

        // Check wallet balance
        const walletResponse = await axios.get(
          `http://localhost:4003/wallet/${req.body.userId}`,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (walletResponse.data?.status !== 'success') {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, 'Failed to fetch wallet balance');
          return res.status(500).json({
            status: 'fail',
            message: 'Failed to fetch wallet balance',
          });
        }

        const balance = walletResponse.data.data.balance;
        if (balance < finalAmount) {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, 'Insufficient wallet balance');
          return res.status(400).json({
            status: 'fail',
            message: `Insufficient wallet balance. Available: ${balance}, Required: ${finalAmount}`,
          });
        }

        // Create debit transaction
        const transactionData = {
          customerID: req.body.userId,
          transactionID: `APMT_PAYMENT_${req.body.appointmentId}_${Date.now()}`,
          amount: finalAmount,
          transactionType: 'debit',
          purpose: 'appointment_payment',
          description: `Payment for appointment ${req.body.appointmentId}`,
          currency: 'INR',
          status: 'approved',
          createdAt: Date.now(),
          createdBy: req.headers?.userid || 'system',
          updatedAt: Date.now(),
          updatedBy: req.headers?.userid || 'system',
          statusHistory: [
            {
              note: `Payment deducted for appointment ${req.body.appointmentId}`,
              status: 'approved',
              updatedAt: Date.now(),
              updatedBy: req.headers?.userid || 'system',
            },
          ],
        };

        const transactionResponse = await axios.post(
          `http://localhost:4003/wallet/createWalletTransaction`,
          transactionData,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (transactionResponse.data?.status !== 'success') {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, 'Wallet payment failed');
          return res.status(500).json({
            status: 'fail',
            message: `Wallet payment failed: ${transactionResponse.data?.message || 'Unknown error'}`,
          });
        }

        paymentResponse = {
          status: 'success',
          data: {
            ...transactionData,
            paymentStatus: 'paid',
            paymentMethod: 'wallet',
            paymentFrom: 'appointment',
            appSource: req.body.appSource,
          },
        };

        updatedAppointment = await appointmentModel.findByIdAndUpdate(
          appointment._id,
          { appointmentStatus: 'scheduled', paymentStatus: 'paid' },
          { new: true }
        );
      } catch (err) {
        console.error('Error processing wallet payment:', err.message);
        await cancelSlotAndUpdateAppointmentStatus(appointment, req, 'Wallet payment failed');
        return res.status(err.response?.status || 500).json({
          status: 'fail',
          message: `Wallet payment failed: ${err.message}`,
        });
      }
    } 
    // --- Case 1: patientApp with referralCode ---
   else  if (req.body.appSource === "patientApp" && req.body.referralCode) {
      try {
        // Call users service to check referral status
        const referralResp = await axios.get(
          `http://localhost:4001/auth/referral/${req.body.referralCode}`,
          {
            headers: {
              "Content-Type": "application/json",
              // Authorization: req.headers.authorization || ''
            },
          }
        );
        const referral = referralResp.data?.data;
        console.log("referral", referral);
        if (!referral) {
          await cancelSlotAndUpdateAppointmentStatus(
            appointment,
            req,
            "Invalid referral code"
          ); // 🔴 release slot
          return res.status(404).json({
            status: "fail",
            message: "Invalid referral code",
          });
        }
        // ✅ Ensure referral belongs to the same user who is booking
        if (referral.referredTo !== req.body.createdBy) {
          await cancelSlotAndUpdateAppointmentStatus(
            appointment,
            req,
            "Referral code not valid for this user"
          );
          return res.status(400).json({
            status: "fail",
            message: "This referral code is not valid for this user",
          });
        }
        if (referral.status === "completed") {
          await cancelSlotAndUpdateAppointmentStatus(
            appointment,
            req,
            "Referral already used"
          );
          return res.status(400).json({
            status: "fail",
            message: "Referral already used",
          });
        }

        if (referral.status === "pending") {
          // Create free payment
          paymentResponse = await createPayment(req.headers.authorization, {
            userId: req.body.userId,
            doctorId: req.body.doctorId,
            addressId: req.body.addressId,
            appointmentId: req.body.appointmentId,
            actualAmount: req.body.amount,
            discount: req.body.discount || 0,
            discountType: req.body.discountType,
            // discountType: 'referral',
            finalAmount: req.body.finalAmount,
            paymentStatus: "paid",
            paymentMethod: "free",
            paymentFrom: "appointment",
            appSource: req.body.appSource,
            platformFee: PLATFORM_FEE,
          });
          console.log("paymentResponse", paymentResponse);
          if (!paymentResponse || paymentResponse.status !== "success") {
            return res.status(500).json({
              status: "fail",
              message: "Payment failed, appointment not created.",
            });
          }

          // Update referral status to completed
          const referralUpdateResp = await axios.patch(
            `http://localhost:4001/auth/referral/${req.body.referralCode}/${referral.referredTo}`,
            { status: 'completed' ,
              appointmentId: req.body.appointmentId, // Store appointmentId
            },
            {
              headers: {
                "Content-Type": "application/json",
              },
            }
          );
          console.log("referralUpdateResp", referralUpdateResp.data);

          // Update appointment status to scheduled
          updatedAppointment = await appointmentModel.findByIdAndUpdate(
            appointment._id,
            { appointmentStatus: "scheduled" },
            { new: true }
          );
        }
      } catch (err) {
        console.error("Error verifying referral:", err.message);
        await cancelSlotAndUpdateAppointmentStatus(
          appointment,
          req,
          "Error verifying referral"
        );
        return res.status(500).json({
          status: "fail",
          message: "Error verifying referral",
          error: err.message,
        });
      }
    } else if (
      req.body.paymentStatus === "paid" &&
      req.body.appSource !== "patientApp"
    ) {
      paymentResponse = await createPayment(req.headers.authorization, {
        userId: req.body.userId,
        doctorId: req.body.doctorId,
        addressId: req.body.addressId,
        appointmentId: req.body.appointmentId,
        actualAmount: req.body.amount,
        discount: req.body.discount || 0,
        discountType: req.body.discountType,
        finalAmount: req.body.finalAmount,
        paymentStatus: "paid",
        paymentFrom: "appointment",
        appSource: req.body.appSource,
      });

      if (!paymentResponse || paymentResponse.status !== "success") {
        return res.status(500).json({
          status: "fail",
          message: "Payment failed, appointment not created.",
        });
      }

      // Step 7: Update appointment status to 'scheduled' after successful payment
      updatedAppointment = await appointmentModel.findByIdAndUpdate(
        appointment._id,
        { appointmentStatus: "scheduled" },
        { new: true }
      );

      if (!updatedAppointment) {
        return res.status(404).json({
          status: "fail",
          message: "Appointment not created",
        });
      }
    }

    return res.status(200).json({
      status: "success",
      message: "Appointment created successfully",
      data: {
        appointmentDetails: updatedAppointment,
        paymentDetails: paymentResponse.data,
        appointmentId: req.body.appointmentId,
        appointmentObjId: appointment._id,
        platformfee: PLATFORM_FEE,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error creating appointment",
      error: error.message,
    });
  }
};

exports.createAppointment = async (req, res) => {
  try {
    // Step 1: Validate Input
    const { error } = appointmentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: "fail",
        message: error.details[0].message,
      });
    }
    // Step 2: Check appointment time validity
    const appointmentDateTime = moment.tz(
      `${req.body.appointmentDate} ${req.body.appointmentTime}`,
      "YYYY-MM-DD HH:mm",
      "Asia/Kolkata"
    );
    const now = moment.tz("Asia/Kolkata");

    if (appointmentDateTime.isBefore(now)) {
      return res.status(400).json({
        status: "fail",
        message: "Appointment date & time must not be in the past.",
      });
    }

    // Additional check: Limit to next two weeks
    const twoWeeksFromNow = now.clone().add(14, 'days');
    if (appointmentDateTime.isAfter(twoWeeksFromNow)) {
      return res.status(400).json({
        status: "fail",
        message: "Appointment date must be within the next two weeks.",
      });
    }
    // Step 3: Check if slot is already booked
    const checkSlotAvailable = await appointmentModel.find({
      doctorId: req.body.doctorId,
      appointmentDate: new Date(req.body.appointmentDate),
      appointmentTime: req.body.appointmentTime,
      appointmentStatus: { $in: ["pending", "scheduled"] },
    });

    if (checkSlotAvailable.length > 0) {
      return res.status(400).json({
        status: "fail",
        message: "Slot already booked or unavailable for this date and time",
      });
    }
     req.body.createdBy = req.headers?.userid || null;
    req.body.updatedBy = req.headers?.userid || null;
    req.body.referralCode = req.body.referralCode || null;
    // Step 4: Validate wallet balance (if applicable)
    const finalAmount = req.body.finalAmount || req.body.amount;
    if (req.body.appSource === "patientApp" && req.body.paymentMethod === "wallet") {
      try {
        // 🔹 1. Check KYC Verification
    const kycResponse = await axios.get(
      `http://localhost:4002/users/getKycByUserId?userId=${req.body.userId}`,
      { headers: { "Content-Type": "application/json" } }
    );

    if (kycResponse.data?.status !== "success") {
      return res.status(500).json({
        status: "fail",
        message: "Failed to fetch KYC details",
      });
    }

    const kycData = kycResponse.data?.data;
    if (!kycData || !kycData.kycVerified) {
      return res.status(400).json({
        status: "fail",
        message: "KYC verification is required to use wallet balance.",
      });
    }
        const walletResponse = await axios.get(
          `http://localhost:4003/wallet/${req.body.userId}`,
          { headers: { "Content-Type": "application/json" } }
        );

        if (walletResponse.data?.status !== "success") {
          return res.status(500).json({
            status: "fail",
            message: "Failed to fetch wallet balance",
          });
        }

        const balance = walletResponse.data.data.balance;
        console.log("Wallet balance:", balance);
        if (balance < finalAmount) {
          return res.status(400).json({
            status: "fail",
            message: `Insufficient wallet balance. Available: ${balance}, Required: ${finalAmount}`,
          });
        }
      } catch (err) {
        console.error("Error checking wallet balance:", err.message);
        return res.status(err.response?.status || 500).json({
          status: "fail",
          message: `Failed to check wallet balance: ${err.message}`,
        });
      }
    }
    // Step 5: Validate referral code (if applicable)
    if (req.body.appSource === "patientApp" && req.body.referralCode) {
      try {
        const referralResp = await axios.get(
          `http://localhost:4001/auth/referral/${req.body.referralCode}`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: req.headers.authorization || "", // Added for consistency
            },
          }
        );
        const referral = referralResp.data?.data;

        if (!referral) {
          return res.status(400).json({
            status: "fail",
            message: "Invalid referral code",
          });
        }

        if (referral.referredTo !== req.body.createdBy) {
          return res.status(400).json({
            status: "fail",
            message: "This referral code is not valid for this user",
          });
        }

        if (referral.status === "completed") {
          return res.status(400).json({
            status: "fail",
            message: "Referral already used",
          });
        }
      } catch (err) {
        console.error("Error verifying referral:", err.message);
        return res.status(500).json({
          status: "fail",
          message: "Error verifying referral",
          error: err.message,
        });
      }
    }
    // Step 6: Generate appointmentId
    const appointmentCounter = await sequenceSchema.findByIdAndUpdate(
      { _id: SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.APPOINTMENTS_MODEL },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // Step 7: Prepare appointment data
    req.body.appointmentId =
      SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.SEQUENCE.concat(appointmentCounter.seq);
   
    // Step 8: Handle optional medicalReport (upload to S3)
    if (req.file) {
      const fileExt = path.extname(req.file.originalname);
      const s3Key = `medicalReports/${req.body.appointmentId}_${Date.now()}${fileExt}`;

      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      req.body.medicalReport = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    }
    // Step 9: Check and book slot
    const bookingResult = await bookSlot(req);
    if (!bookingResult || bookingResult.modifiedCount === 0) {
      return res.status(400).json({
        status: "fail",
        message: "Slot already booked or slots do not exist. Check slot availability.",
      });
    }
    // Step 10: Create appointment
    const appointment = await appointmentModel.create(req.body);
    // Step 11: Process payment
    let paymentResponse;
    let updatedAppointment;
    const paymentData = {
      userId: req.body.userId,
      doctorId: req.body.doctorId,
      addressId: req.body.addressId,
      appointmentId: req.body.appointmentId,
      actualAmount: req.body.amount,
      discount: req.body.discount || 0,
      discountType: req.body.discountType,
       finalAmount: req.body.finalAmount || req.body.amount,
      paymentStatus: "paid",
      paymentFrom: "appointment",
      appSource: req.body.appSource,
    };

    if (req.body.appSource === "patientApp" && req.body.paymentMethod === "wallet") {
      try {
        const transactionData = {
          customerID: req.body.userId,
          transactionID: `APMT_PAYMENT_${req.body.appointmentId}_${Date.now()}`,
          amount: finalAmount,
          transactionType: "debit",
          purpose: "appointment_payment",
          description: `Payment for appointment ${req.body.appointmentId}`,
          currency: "INR",
          appointmentId: req.body.appointmentId,
          status: "pending",
          createdAt: Date.now(),
          createdBy: req.headers?.userid || "system",
          updatedAt: Date.now(),
          updatedBy: req.headers?.userid || "system",
          statusHistory: [
            {
             note: `Pending payment for appointment ${req.body.appointmentId}`,
          status: "pending",
              updatedAt: Date.now(),
              updatedBy: req.headers?.userid || "system",
            },
          ],
        };

        const transactionResponse = await axios.post(
          `http://localhost:4003/wallet/createWalletTransaction`,
          transactionData,
          { headers: { "Content-Type": "application/json" } }
        );
        if (transactionResponse.data?.status !== "success") {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Wallet payment failed");
          return res.status(500).json({
            status: "fail",
            message: `Wallet payment failed: ${transactionResponse.data?.message || "Unknown error"}`,
          });
        }
         const refferalPaymentData = { ...paymentData };
        delete refferalPaymentData.finalAmount;
        // Create payment record for wallet
        paymentResponse = await createPayment(req.headers.authorization, {
          ...refferalPaymentData,
          paymentMethod: "wallet",
          platformFee: PLATFORM_FEE,
        });
        if (!paymentResponse || paymentResponse.status !== "success") {
          // Reverse wallet transaction
      await axios.post(
        `http://localhost:4003/wallet/updateWalletTransaction`,
        {
          customerID: req.body.userId,
          transactionID: transactionData.transactionID,
          status: "failed",
          statusHistory: [
            ...transactionData.statusHistory,
            {
              note: `Transaction failed due to payment service error`,
              status: "failed",
              updatedAt: Date.now(),
              updatedBy: req.headers?.userid || "system",
            },
          ],
        },
        { headers: { "Content-Type": "application/json" } }
      );
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Payment failed");
          return res.status(500).json({
            status: "fail",
            message: "Payment failed, appointment not created.",
          });
        }

        // Update wallet transaction to approved
  const update=   await axios.post(
      `http://localhost:4003/wallet/updateWalletTransaction`,
      {
        customerID: req.body.userId,
        transactionID: transactionData.transactionID,
        status: "approved",
        statusHistory: [
          ...transactionData.statusHistory,
          {
            note: `Payment approved for appointment ${req.body.appointmentId}`,
            status: "approved",
            updatedAt: Date.now(),
            updatedBy: req.headers?.userid || "system",
          },
        ],
      },
      { headers: { "Content-Type": "application/json" } }
    );
        // Update appointment for wallet payment
        updatedAppointment = await appointmentModel.findByIdAndUpdate(
          appointment._id,
          { appointmentStatus: "scheduled", paymentStatus: "paid" },
          { new: true }
        );
      } catch (err) {
        console.log("err", err?.response?.data);
        console.error("Error processing wallet payment:", err.message);
       
        await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Wallet payment failed");
        return res.status(err.response?.status || 500).json({
          status: "fail",
          message: `Wallet payment failed: ${err.message}`,
        });
      }
    } else if (req.body.appSource === "patientApp" && req.body.referralCode) {
      try {
        const refferalPaymentData = { ...paymentData };
        delete refferalPaymentData.finalAmount;
        // Create payment record for referral
        paymentResponse = await createPayment(req.headers.authorization, {
          ...refferalPaymentData,
          paymentMethod: "free",
          platformFee: PLATFORM_FEE,
        });
console.log("paymentResponse", paymentResponse);
        if (!paymentResponse || paymentResponse.status !== "success") {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Payment failed");
          return res.status(500).json({
            status: "fail",
            message: "Payment failed, appointment not created.",
          });
        }

        // Update referral status to completed
        const referralUpdateResp = await axios.patch(
          `http://localhost:4001/auth/referral/${req.body.referralCode}/${req.body.createdBy}`,
          {
            status: "completed",
            appointmentId: req.body.appointmentId,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: req.headers.authorization || "",
            },
          }
        );
console.log("referralUpdateResp", referralUpdateResp.data);
        if (referralUpdateResp.data?.status !== "success") {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Referral update failed");
          return res.status(500).json({
            status: "fail",
            message:  referralUpdateResp.data?.message || "Failed to update referral status",
          });
        }

        // Update appointment for referral
        updatedAppointment = await appointmentModel.findByIdAndUpdate(
          appointment._id,
          { appointmentStatus: "scheduled", paymentStatus: "paid" },
          { new: true }
        );
      } catch (err) {
        console.log("err", err?.message);
        console.error("Error processing referral payment:", err.message);
        await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Referral payment failed");
        return res.status(500).json({
          status: "fail",
          message: err?.message || "Error processing referral payment",
          error: err.message,
        });
      }
    } else if (req.body.paymentStatus === "paid" && req.body.appSource !== "patientApp") {
      try {
         const refferalPaymentData = { ...paymentData };
        delete refferalPaymentData.finalAmount;
        // Create payment record for non-patientApp
        paymentResponse = await createPayment(req.headers.authorization, {
          ...refferalPaymentData,
          paymentMethod: req.body.paymentMethod || "cash",
        });

        if (!paymentResponse || paymentResponse.status !== "success") {
          await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Payment failed");
          return res.status(500).json({
            status: "fail",
            message: "Payment failed, appointment not created.",
          });
        }

        // Update appointment for non-patientApp
        updatedAppointment = await appointmentModel.findByIdAndUpdate(
          appointment._id,
          { appointmentStatus: "scheduled", paymentStatus: "paid" },
          { new: true }
        );
      } catch (err) {
        console.error("Error processing payment:", err.message);
        await cancelSlotAndUpdateAppointmentStatus(appointment, req, "Payment failed");
        return res.status(500).json({
          status: "fail",
          message: "Error processing payment",
          error: err.message,
        });
      }
    } 

    // Step 11: Send FCM Notification if patientApp and fcmToken exists
    const appointmentToNotify = updatedAppointment || appointment;
   if (req.body.appSource === "patientApp") {
  try {
    // Fetch patient info
      const patient = await getMinimalUser(req.body.userId, req.headers.authorization);
  
    if (!patient || !patient.fcmToken) {
      console.log("No FCM token found for the patient, skipping notification");
    } else {
      // Fetch doctor info
       const doctor = await getMinimalUser(req.body.doctorId, req.headers.authorization);
   
      const doctorName = doctor ? `Dr. ${doctor.firstname} ${doctor.lastname}` : "your doctor";

      sendNotification(
        patient.fcmToken, // use token from user model
        'Appointment Created',
        `Your appointment with ${doctorName} is scheduled on ${req.body.appointmentDate} at ${req.body.appointmentTime}`,
        { appointmentId: req.body.appointmentId }
      );
    }
  } catch (err) {
    console.error("Error sending FCM notification:", err.message);
  }
}
   

    return res.status(200).json({
      status: "success",
      message: "Appointment created successfully",
      data: {
        appointmentDetails: updatedAppointment || appointment,
        paymentDetails: paymentResponse?.data,
        appointmentId: req.body.appointmentId,
        appointmentObjId: appointment._id,
        platformfee: PLATFORM_FEE,
      },
    });
  } catch (error) {
    console.log("Error details:", error);
    console.error("Error creating appointment:", error.message);
    return res.status(500).json({
      status: "fail",
      message: "Error creating appointment",
      error: error.message,
    });
  }
};

//getAllAppointmentCount
exports.getAllAppointments = async (req, res) => {
  try {
    // Fetch all appointments without any filters
    const appointments = await appointmentModel.find({});

    return res.status(200).json({
      status: "success",
      message: "Appointments retrieved successfully",
      data: {
        totalAppointmentsCount: appointments.length,
        totalAppointments: appointments,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "fail",
      message: "Error retrieving appointments",
      error: error.message,
    });
  }
};

exports.getAppointmentsWithPayments = async (req, res) => {
  try {
    const {
      doctorId,
      appointmentType,
      appointmentDepartment,
      appointmentStatus,
      appointmentDate,
      fromDate,
      toDate,
    } = req.query;

    if (!doctorId) {
      return res
        .status(400)
        .json({ status: "fail", message: "doctorId is required" });
    }

    const query = { doctorId };
    if (appointmentType) query.appointmentType = appointmentType;
    if (appointmentDepartment)
      query.appointmentDepartment = appointmentDepartment;
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
      return res
        .status(404)
        .json({ status: "fail", message: "No appointments found" });
    }

    // Prepare user IDs and appointment IDs
    const userIdsSet = new Set();
    const appointmentIds = [];

    appointments.forEach((appt) => {
      userIdsSet.add(appt.userId);
      userIdsSet.add(appt.doctorId);
      appointmentIds.push(appt.appointmentId.toString());
    });

    const allUserIds = Array.from(userIdsSet);
    const authHeader = req.headers.authorization;

    // Call external services in parallel
    const [users, paymentResp] = await Promise.all([
      getUserDetailsBatch(authHeader, { userIds: allUserIds }),
      getAppointmentPayments(authHeader, { appointmentIds }),
    ]);

    const userMap = new Map(users.map((user) => [user.userId, user]));
    const paymentMap = new Map(
      paymentResp.payments.map((payment) => [payment.appointmentId, payment])
    );

    // Construct response
    const result = appointments.map((appt) => ({
      ...appt.toObject(),
      patientDetails: userMap.get(appt.userId) || null,
      doctorDetails: userMap.get(appt.doctorId) || null,
      paymentDetails: paymentMap.get(appt.appointmentId.toString()) || null,
    }));

    res.json({ status: "success", data: result });
  } catch (err) {
    console.error("Error in getAppointmentsWithPayments:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

async function findSlotByDateTime(doctorId, date, time) {
  if (!doctorId || !date || !time) {
    throw new Error("doctorId, date and time are required to find a slot");
  }

  const start = new Date(date);
  const end = new Date(date);
  end.setDate(end.getDate() + 1);
  const query = {
    doctorId,
    date: { $gte: start, $lt: end },
    slots: {
      $elemMatch: {
        status: { $in: ["booked", "unavailable"] },
        time: time,
        appointmentId: { $ne: null },
      },
    },
  };
  return await DoctorSlotModel.find(query);
}

async function bookSlot(req) {
  const {
    doctorId,
    addressId,
    appointmentDate,
    appointmentTime,
    appointmentId,
  } = req.body;
  if (
    !doctorId ||
    !addressId ||
    !appointmentDate ||
    !appointmentTime ||
    !appointmentId
  ) {
    throw new Error(
      "doctorId, addressId, appointmentDate, appointmentTime and appointmentId are required to book a slot"
    );
  }
  const result = await DoctorSlotModel.updateOne(
    {
      doctorId,
      addressId,
      date: appointmentDate,
    },
    {
      $set: {
        "slots.$[elem].status": "booked",
        "slots.$[elem].appointmentId": appointmentId,
        "slots.$[elem].updatedBy": req.headers.userid,
        "slots.$[elem].updatedAt": new Date(),
      },
    },
    {
      arrayFilters: [
        {
          "elem.time": appointmentTime,
          "elem.status": "available",
        },
      ],
    }
  );
  return result;
}

async function cancelSlot(appointment, req) {
  const {
    appointmentId,
    doctorId,
    addressId,
    appointmentDate,
    appointmentTime,
  } = appointment;
  if (
    !appointmentId ||
    !doctorId ||
    !addressId ||
    !appointmentDate ||
    !appointmentTime
  ) {
    throw new Error(
      "appointmentId, doctorId, addressId, appointmentDate, appointmentTime are required to cancel a slot"
    );
  }

  const result = await DoctorSlotModel.updateOne(
    {
      doctorId,
      addressId,
      date: appointmentDate,
    },
    {
      $set: {
        "slots.$[elem].status": "available",
        "slots.$[elem].appointmentId": null,
        "slots.$[elem].updatedBy": req.headers.userid,
        "slots.$[elem].updatedAt": new Date(),
      },
    },
    {
      arrayFilters: [
        {
          "elem.appointmentId": appointmentId,
          "elem.time": appointmentTime,
          "elem.status": { $in: ["booked", "pending", "unavailable"] },
        },
      ],
    }
  );
  console.log("cancelSlotresult", result);
}

exports.releaseDoctorSlot = async (req, res) => {
  const appointment = req.body.appointmentDetails;
  const appointmentId = appointment.appointmentId;
  const reason = req.body.reason || "Slot released due to payment failure";
  if (!appointment.doctorId || !appointment.appointmentId) {
    return res
      .status(400)
      .json({
        status: "fail",
        message: "doctorId and appointmentId are required",
      });
  }
  try {
    await cancelSlot(appointment, req);

    /**
     * Update the appointment status to 'cancelled'
     * This will mark the appointment as cancelled and store the cancellation reason
     */
    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId: appointmentId },
      {
        $set: {
          appointmentStatus: "cancelled",
          cancellationReason: reason,
          updatedBy: req.headers ? req.headers.userid : "",
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    res.json({ status: "success", message: "Slot released successfully" });
  } catch (err) {
    console.error("Error in releaseDoctorSlot:", err);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

exports.getAppointmentTypeCounts = async (req, res) => {
  const { doctorId } = req.query;
  const match = {
    appointmentStatus: { $ne: "cancelled" },
    appointmentType: { $in: ["In-Person", "Video", "home-visit"] },
  };
  if (doctorId) {
    match.doctorId = doctorId;
  }
  try {
    const counts = await appointmentModel.aggregate([
      {
        $match: {
          appointmentStatus: { $ne: "cancelled" },
          appointmentType: { $in: ["In-Person", "Video", "home-visit"] },
        },
      },
      {
        $group: {
          _id: "$appointmentType",
          count: { $sum: 1 },
        },
      },
    ]);
    // Format response as { appointmentType: count }
    const result = {
      "In-Person": 0,
      Video: 0,
      "home-visit": 0,
    };
    counts.forEach((item) => {
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

    // console.log('--- Dates ---');
    // console.log({ todayStart, todayEnd, tomorrowStart, doctorId });
    // Date-based counts
    const todayQuery = {
      ...baseQuery,
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
    };
    const upcomingQuery = {
      ...baseQuery,
      appointmentDate: { $gte: tomorrowStart },
    };

    // Status-based counts (all dates)
    const completedQuery = { ...baseQuery, appointmentStatus: "completed" };
    const rescheduledQuery = { ...baseQuery, appointmentStatus: "rescheduled" };
    const scheduledQuery = { ...baseQuery, appointmentStatus: "scheduled" };
    const cancelledQuery = { ...baseQuery, appointmentStatus: "cancelled" };
    const activeQuery = {
      ...baseQuery,
      appointmentStatus: { $nin: ["cancelled", "completed"] },
    };
    const totalQuery = { ...baseQuery };

    const [
      today,
      upcoming,
      completed,
      rescheduled,
      scheduled,
      cancelled,
      active,
      total,
    ] = await Promise.all([
      appointmentModel.countDocuments(todayQuery),
      appointmentModel.countDocuments(upcomingQuery),
      appointmentModel.countDocuments(completedQuery),
      appointmentModel.countDocuments(rescheduledQuery),
      appointmentModel.countDocuments(scheduledQuery),
      appointmentModel.countDocuments(cancelledQuery),
      appointmentModel.countDocuments(activeQuery),
      appointmentModel.countDocuments(totalQuery),
    ]);

    res.json({
      status: "success",
      data: {
        today,
        upcoming,
        completed,
        rescheduled,
        scheduled,
        cancelled,
        active,
        total,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};

exports.getUniquePatientsStats = async (req, res) => {
  try {
    const { doctorId } = req.query;
    if (!doctorId) {
      return res
        .status(400)
        .json({ status: "fail", message: "doctorId is required" });
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
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    // Helper for aggregation
    const uniquePatients = async (match) => {
      const result = await appointmentModel.aggregate([
        { $match: match },
        { $group: { _id: "$userId" } },
        { $count: "count" },
      ]);
      return result[0]?.count || 0;
    };
    const baseMatch = { doctorId, appointmentStatus: { $ne: "cancelled" } };
    const [total, today, week, month] = await Promise.all([
      uniquePatients(baseMatch),
      uniquePatients({
        ...baseMatch,
        appointmentDate: { $gte: todayStart, $lte: todayEnd },
      }),
      uniquePatients({
        ...baseMatch,
        appointmentDate: { $gte: weekStart, $lte: weekEnd },
      }),
      uniquePatients({
        ...baseMatch,
        appointmentDate: { $gte: monthStart, $lte: monthEnd },
      }),
    ]);
    res.json({
      status: "success",
      data: {
        total,
        today,
        week,
        month,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};

exports.getTopDoctorsByAppointmentCount = async (req, res) => {
  try {
    const topDoctors = await appointmentModel.aggregate([
      { $match: { appointmentStatus: { $ne: "cancelled" } } },
      {
        $group: {
          _id: "$doctorId",
          count: { $sum: 1 },
          doctorName: { $first: "$doctorName" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $project: {
          doctorId: "$_id",
          doctorName: 1,
          count: 1,
          _id: 0,
        },
      },
    ]);
    res.json({ status: "success", data: topDoctors });
  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};



async function initiateCashfreeRefund(orderId, refundId, amount, note) {
  try {
    const resp = await axios.post(
      `https://api.cashfree.com/pg/orders/${orderId}/refunds`,
      {
        refund_amount: amount,
        refund_id: refundId,
        refund_note: note,
        refund_speed: "STANDARD", // or "INSTANT" if enabled on your account
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-version": "2022-09-01",
          "x-client-id": process.env.pgAppID,
          "x-client-secret": process.env.pgSecreteKey,
        },
      }
    );

    return resp.data;
  } catch (error) {
    console.error("Cashfree refund error:", error.response?.data || error.message);
    throw new Error("Refund initiation failed");
  }
}


exports.cancelAppointment = async (req, res) => {
  const { appointmentId, reason } = req.body;
  if (!appointmentId) {
    return res
      .status(400)
      .json({ status: "fail", message: "appointmentId is required" });
  }
  if (!reason) {
    return res
      .status(400)
      .json({ status: "fail", message: "Cancellation reason is required" });
  }

  try {
    const appointment = await appointmentModel.findOne({
      appointmentId: appointmentId,
    });
    if (!appointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Appointment not found" });
    }

    const resp = await axios.get(
      `http://localhost:4002/pharmacy/getEPrescriptionByAppointmentId/${appointmentId}`,
      {
        headers: {
          "Content-Type": "application/json",
          // Add authorization headers if needed
          // 'Authorization': `Bearer ${req.headers.authorization}`
        },
      }
    );
    if (resp?.data?.data?.length > 0) {
      console.log("Prescription exists, cannot cancel appointment");
      return res
        .status(400)
        .json({
          status: "fail",
          message: "Cannot cancel appointment with existing prescription",
        });
    }

    // Only cancel if not already cancelled or completed
    if (["cancelled", "completed"].includes(appointment.appointmentStatus)) {
      return res
        .status(400)
        .json({
          status: "fail",
          message: `Cannot cancel appointment already marked as ${appointment.appointmentStatus}`,
        });
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

    /**
     * Update the payment status to 'refund_pending'
     * This will initiate the refund process for the patient
     * The payment service has an endpoint to update payment status
     * If the payment status is already 'success', we will update it to 'refund_pending'
     * If the payment status is not 'success', we will return an error
     */
    const payment = await updatePayment(req.headers.authorization, {
      appointmentId: appointment.appointmentId,
      status: "refund_pending",
    });

    console.log("Payment update response:", payment);
    if (!payment || payment.status !== "success") {
      return res.status(500).json({
        status: "fail",
        message:
          "Failed to update payment status to refund_pending. Please try again later.",
      });
    }

    // Handle refund for wallet payments
    if (payment.data.paymentMethod === "wallet") {
      try {
        const refundTransactionData = {
          customerID: appointment.userId,
          transactionID: `REFUND_${appointment.appointmentId}_${Date.now()}`,
          amount: payment.data.finalAmount,
          transactionType: "credit",
          purpose: "appointment_refunded",
          description: `Refund for canceled appointment ${appointment.appointmentId}`,
          currency: "INR",
          appointmentId: appointment.appointmentId,
          status: "approved", // Directly mark as approved for wallet refunds
          createdAt: Date.now(),
          createdBy: req.headers?.userid || "system",
          updatedAt: Date.now(),
          updatedBy: req.headers?.userid || "system",
          statusHistory: [
            {
                note: `Refund approved for appointment ${appointment.appointmentId}`,
                status: "approved",
              updatedAt: Date.now(),
              updatedBy: req.headers?.userid || "system",
            },
          ],
        };

        // Create refund transaction in wallet
        const refundTransactionResponse = await axios.post(
          `http://localhost:4003/wallet/createWalletTransaction`,
          refundTransactionData,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: req.headers.authorization || "",
            },
          }
        );
console.log("Refund transaction response:", refundTransactionResponse.data);
        if (refundTransactionResponse.data?.status !== "success") {
          return res.status(500).json({
        status: "fail",
        message:`Failed to create refund transaction: ${refundTransactionResponse.data?.message || "Unknown error"}`

      }); 
        }

       console.log("Wallet refund transaction created:", refundTransactionResponse.data.data);
        // Update payment status to refunded
        const finalPaymentUpdate = await updatePayment(req.headers.authorization, {
          appointmentId: appointment.appointmentId,
          status: "refunded",
        });
console.log("Final payment update after refund:", finalPaymentUpdate);
        if (!finalPaymentUpdate || finalPaymentUpdate.status !== "success") {
            return res.status(500).json({
        status: "fail",
        message:"Failed to update payment status to refunded"
      });
        }
      } catch (err) {
        console.log("Error processing wallet refund:", err.message);
        console.error("Refund Error:", err.message);
        // Rollback payment status to failed if refund fails
        await updatePayment(req.headers.authorization, {
          appointmentId: appointment.appointmentId,
          status: "refund_failed",
        });
        return res.status(500).json({
          status: "fail",
          message: `Refund failed: ${err.message}`,
        });
      }
    }
else if (payment.data.paymentMethod === "upi") {
  try {
    const refundResponse = await initiateCashfreeRefund(
      payment.data.transactionId, // Cashfree order id stored when payment was made
      `REFUND_${appointment.appointmentId}_${Date.now()}`, // unique refund_id
      payment.data.finalAmount, // refund amount
      `Refund for cancelled appointment ${appointment.appointmentId}` // refund note
    );

    console.log("Cashfree refund response:", refundResponse);

    if (refundResponse?.refund_status === "SUCCESS" || refundResponse?.refund_status === "PENDING") {
      await updatePayment(req.headers.authorization, {
        appointmentId: appointment.appointmentId,
        status: "refunded",
      });
    } else {
      await updatePayment(req.headers.authorization, {
        appointmentId: appointment.appointmentId,
        status: "refund_failed",
      });
    }
  } catch (err) {
    console.error("Refund failed:", err.message);
    await updatePayment(req.headers.authorization, {
      appointmentId: appointment.appointmentId,
      status: "refund_failed",
    });
    return res.status(500).json({ status: "fail", message: "Refund failed" });
  }
}


        
    /**
     * Cancel the slot in DoctorSlotModel
     * This will set the slot status to 'available' and clear the appointmentId
     * This is necessary to free up the slot for other patients
     */
    await cancelSlot(appointment, req);

    /**
     * Update the appointment status to 'cancelled'
     * This will mark the appointment as cancelled and store the cancellation reason
     */
    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId: appointmentId },
      {
        $set: {
          appointmentStatus: "cancelled",
          cancellationReason: reason,
          updatedBy: req.headers ? req.headers.userid : "",
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updateAppointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Failed to cancel appointment" });
    }

    // ✅ Send push notifications to patient and doctor
    const userIds = [appointment.doctorId, appointment.userId];
    const users = await getUsersByIds(userIds);
    const doctor = users[appointment.doctorId];
    const patient = users[appointment.userId];

    const doctorName = `${doctor?.firstname || ""} ${doctor?.lastname || ""}`.trim();
    const patientName = `${patient?.firstname || ""} ${patient?.lastname || ""}`.trim();
    const patientFcmToken = patient?.fcmToken;
   

    const title = "Appointment Cancelled";
    const patientBody = `Your appointment with Dr. ${doctorName} has been cancelled.`;
    // const doctorBody = `Appointment with patient ${patientName} has been cancelled.`;

    if (patientFcmToken) sendNotification(patientFcmToken, title, patientBody, { appointmentId });
    // if (doctorFcmToken) sendNotification(doctorFcmToken, title, doctorBody, { appointmentId });

    return res.status(200).json({
      status: "success",
      message: "Appointment cancelled successfully",
      // appointmentDetails: appointment,
      // paymentDetails: payment.data || null
    });
  } catch (err) {
    console.error("Cancel Appointment Error:", err);
    return res
      .status(500)
      .json({ status: "fail", message: "Internal server error" });
  }
};

exports.rescheduleAppointment = async (req, res) => {
  const { appointmentId, newDate, newTime, reason } = req.body;
  if (!appointmentId || !newDate || !newTime) {
    return res
      .status(400)
      .json({
        status: "fail",
        message: "appointmentId, newDate and newTime are required",
      });
  }
  const rescheduleDateTime = moment.tz(
    `${moment(newDate).format("YYYY-MM-DD")} ${newTime}`,
    "YYYY-MM-DD HH:mm",
    "Asia/Kolkata"
  );
  if (rescheduleDateTime.isSameOrBefore(moment.tz("Asia/Kolkata"))) {
    return res.status(400).json({
      status: "fail",
      message: "Cannot reschedule past date and time",
    });
  }

  try {
    const appointment = await appointmentModel.findOne({
      appointmentId: appointmentId,
    });
    if (!appointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Appointment not found" });
    }

    const resp = await axios.get(
      `http://localhost:4002/pharmacy/getEPrescriptionByAppointmentId/${appointmentId}`,
      {
        headers: {
          "Content-Type": "application/json",
          // Add authorization headers if needed
          // 'Authorization': `Bearer ${req.headers.authorization}`
        },
      }
    );
    if (resp?.data?.data?.length > 0) {
      console.log("Prescription exists, cannot reschedule appointment");
      return res
        .status(400)
        .json({
          status: "fail",
          message: "Cannot reschedule appointment with existing prescription",
        });
    }

    // Only reschedule if not already cancelled or completed
    if (["cancelled", "completed"].includes(appointment.appointmentStatus)) {
      return res
        .status(400)
        .json({
          status: "fail",
          message: `Cannot reschedule appointment already marked as ${appointment.appointmentStatus}`,
        });
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

    /**
     * Check if the new slot is available
     * This will check if there are any existing appointments for the same doctor, date and time
     * If there are any existing appointments, we will return an error
     * If there are no existing appointments, we will proceed to cancel the current appointment and book the new slot
     */
    const checkSlotAvailable = await appointmentModel.find({
      doctorId: appointment.doctorId,
      appointmentDate: new Date(newDate),
      appointmentTime: newTime,
      appointmentStatus: { $in: ["pending", "scheduled"] },
    });

    const checkSlotAvailability = await findSlotByDateTime(
      appointment.doctorId,
      newDate,
      newTime
    );

    if (checkSlotAvailable.length > 0 || checkSlotAvailability.length > 0) {
      return res.status(208).json({
        status: "fail",
        message: "Slot already booked for this date and time",
      });
    }
    /**
     * Cancel the current appointment slot
     * This will set the slot status to 'available' and clear the appointmentId
     */
    await cancelSlot(appointment, req);
    /**
     * Book the new slot
     * This will set the slot status to 'booked' and set the appointmentId
     */

    const bookingResult = await bookSlot({
      body: {
        appointmentId: appointmentId,
        doctorId: appointment.doctorId,
        addressId: appointment.addressId,
        appointmentDate: new Date(newDate),
        appointmentTime: newTime,
      },
      headers: req.headers,
    });
    if (!bookingResult || bookingResult.modifiedCount === 0) {
      return res.status(404).json({
        status: "fail",
        message:
          "Slot already booked or slots do not exist check in slot availability.",
      });
    }
    /**
     * Update the appointment with new date and time
     * This will update the appointment date, time and status to 'scheduled'
     */
    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId: appointmentId },
      {
        $set: {
          appointmentDate: new Date(newDate),
          appointmentTime: newTime,
          appointmentStatus: "scheduled",
          updatedBy: req.headers ? req.headers.userid : "",
          updatedAt: new Date(),
        },
        $push: {
          rescheduleHistory: {
            previousDate: appointment.appointmentDate,
            previousTime: appointment.appointmentTime,
            rescheduledDate: new Date(newDate),
            rescheduledTime: newTime,
            reason: reason || null,
          },
        },
      },
      { new: true }
    );
    if (!updateAppointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Failed to reschedule appointment" });
    }
    
      // ✅ SMS to Patient: Sends an SMS notification to the patient’s registered mobile number

    
  const templateid = process.env.APPOINTMENT_RESCHEDULE_TEMPLATE_ID || "1707175447494195093"; 

  const userIds = [appointment.doctorId, appointment.userId];
const users = await getUsersByIds(userIds);

const doctor = users[appointment.doctorId];
const patient = users[appointment.userId];

const doctorName = `${doctor?.firstname || ""} ${doctor?.lastname || ""}`.trim();
const patientMobile = patient?.mobile;
 const patientFcmToken = patient?.fcmToken;

    if (patientMobile) {
  const formattedDate = moment(newDate).format("DD-MM-YYYY");
  const rescheduleMsg = `Your appointment with Dr. ${doctorName} has been rescheduled to ${formattedDate} at ${newTime}. Thank you for using VYDHYO.`;
console.log("Reschedule SMS:", rescheduleMsg, patientMobile);
  try {
    await sendOTPSMS(patientMobile, rescheduleMsg,  templateid, "Dear {#var#} {#var#}");
  } catch (error) {
    console.log("Error sending SMS:", error);
    console.error("Failed to send SMS:", error);
  }
}

 // Send push notifications
    const formattedDate = moment(newDate).format("DD-MM-YYYY");
    const title = "Appointment Rescheduled";
    const patientBody = `Your appointment with Dr. ${doctorName} has been rescheduled to ${formattedDate} at ${newTime}.`;
    const doctorBody = `Appointment with patient ${patient?.firstname || ""} ${patient?.lastname || ""} has been rescheduled to ${formattedDate} at ${newTime}.`;

    if (patientFcmToken) {
      sendNotification(patientFcmToken, title, patientBody, { appointmentId });
    }
   

    return res.status(200).json({
      status: "success",
      message: "Appointment rescheduled successfully",
      appointmentDetails: updateAppointment,
    });
  } catch (err) {
    console.error("Reschedule Appointment Error:", err);
    return res
      .status(500)
      .json({ status: "fail", message: "Internal server error" });
  }
};

// async function creditReferralReward(appointment, rewardAmount) {
//   try {
//     // Step 1: Fetch referral details from users service
//     const referralResp = await axios.get(
//       `http://localhost:4001/auth/referral/${appointment.referralCode}/${appointment.appointmentId}`,
//        {
//         headers: {
//           'Content-Type': 'application/json',
//           // Authorization: req.headers.authorization || ''
//         },
//       }
//     );

//     const referral = referralResp.data?.data;
//     if (!referral) {
//       throw {
//       statusCode: 404,
//       message: `Referral not found for code: ${appointment.referralCode} and appointment ID: ${appointment.appointmentId}`,
//     };
//     }

//     // Step 2: Validate referral
//     if (
//     referral.appointmentId !== appointment.appointmentId ||
//       referral.status !== 'completed' ||
//       referral.rewardIssued
//     ) {
//       throw {
//       statusCode: 400,
//       message: `Referral ineligible for reward: code=${appointment.referralCode}, userId=${appointment.userId}, appointmentId=${appointment.appointmentId}, status=${referral.status}, rewardIssued=${referral.rewardIssued}`,
//     };
//     }

//     // Step 3: Create wallet transaction in payments service
//     const transactionResponse = await axios.post(
//       'http://localhost:4003/wallet/createWalletTransaction',
//       {
//         customerID: referral.referredBy,
//         transactionID: `REF_REWARD_${referral.referralCode}_${Date.now()}`,
//         amount: rewardAmount,
//         transactionType: 'credit',
//         purpose: 'referral_reward',
//         description: `Reward for referral code ${referral.referralCode} on appointment ${appointment.appointmentId}`,
//         currency: 'INR',
//         status: 'approved',
//         createdAt: Date.now(),
//         createdBy: 'system',
//         updatedAt: Date.now(),
//         updatedBy: 'system',
//         statusHistory: [
//           {
//             note: `Reward credited for referral ${referral.referralCode}`,
//             status: 'approved',
//             updatedAt: Date.now(),
//             updatedBy: 'system',
//           },
//         ],
//       },
//       {
//         headers: {
//           'Content-Type': 'application/json',
//           // Authorization: req.headers?.authorization || '',
//         },
//       }
//     );
// console.log("transactionResponse",transactionResponse.data)
//     if (transactionResponse.data?.status !== 'success') {
//       throw {
//       statusCode: 500,
//       message: `Failed to create wallet transaction: ${transactionResponse.data?.message || 'Unknown error'}`,
//     };
//     }

//     // Step 4: Update referral status to rewarded in users service
//     const referralUpdateResp = await axios.patch(
//       `http://localhost:4001/auth/referral/${appointment.referralCode}/${appointment.appointmentId}`,
//       { status: 'rewarded', rewardIssued: true },
//       {
//         headers: {
//           'Content-Type': 'application/json',
//           // Authorization: req.headers?.authorization || '',
//         },
//       }
//     );

//     if (referralUpdateResp.data?.status !== 'success') {
//       throw {
//       statusCode: 500,
//       message: `Failed to update referral status: ${referralUpdateResp.data?.message || 'Unknown error'}`,
//     };
//     }

//     console.log(
//       `Reward of ${rewardAmount} INR credited to user ${referral.referredBy} wallet for referral ${referral.referralCode}`
//     );
//     return true;
//   } catch (error) {
//     console.error('Error in creditReferralReward:', error.message);
//     return false;
//   }
// }

exports.completeAppointment = async (req, res) => {
  const { appointmentId, appointmentNotes = "" } = req.body;
  if (!appointmentId) {
    return res
      .status(400)
      .json({ status: "fail", message: "appointmentId is required" });
  }

  try {
    const appointment = await appointmentModel.findOne({
      appointmentId: appointmentId,
    });
    if (!appointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Appointment not found" });
    }

    // Only complete if not already cancelled or completed
    if (["cancelled", "completed"].includes(appointment.appointmentStatus)) {
      return res
        .status(400)
        .json({
          status: "fail",
          message: `Cannot complete appointment already marked as ${appointment.appointmentStatus}`,
        });
    }

    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId: appointmentId },
      {
        $set: {
          appointmentStatus: "completed",
          appointmentNotes: appointmentNotes,
          updatedBy: req.headers ? req.headers.userid : "",
          updatedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!updateAppointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Failed to complete appointment" });
    }

    // Credit referral reward if referralCode exists
    if (updateAppointment.referralCode) {
      // const REWARD_AMOUNT = 100; // Define your reward amount here (e.g., 100 INR)
    try {
        await creditReferralReward(updateAppointment, REWARD_AMOUNT);
      } catch (error) {
        consolwe.error("Referral Reward Error:", error);  
        // Return the error from creditReferralReward, but allow appointment completion
        return res.status(error.statusCode || 500).json({
          status: 'fail',
          message: `Appointment completed, but failed to credit referral reward: ${error.message}`,
        });
      }
    }


    return res.status(200).json({
      status: "success",
      message: "Appointment completed successfully",
      appointmentDetails: updateAppointment,
    });
  } catch (err) {
    console.error("Complete Appointment Error:", err);
    return res
      .status(500)
      .json({ status: "fail", message: "Internal server error" });
  }
};

exports.updateAppointmentById = async (req, res) => {
  const { appointmentId, ...updateData } = req.body;

  if (!appointmentId) {
    return res
      .status(400)
      .json({ status: "fail", message: "appointmentId is required" });
  }

  // Allowed fields for normal updates
  const allowedFields = ["appointmentReason", "appointmentNotes"];

  try {
    const appointment = await appointmentModel.findOne({ appointmentId });
    if (!appointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Appointment not found" });
    }

    let filteredUpdateData = {};

    const allowedIfFinal = ["appointmentNotes", "appointmentReason"];

    for (const key of allowedIfFinal) {
      if (key in updateData) {
        filteredUpdateData[key] = updateData[key];
      }
    }

    // If trying to update other fields → block
    const extraKeys = Object.keys(updateData).filter(
      (k) => !allowedIfFinal.includes(k)
    );
    if (extraKeys.length > 0) {
      return res.status(400).json({
        status: "fail",
        message: `Cannot update fields ${extraKeys.join(", ")} for a ${
          appointment.appointmentStatus
        } appointment`,
      });
    }

    const updatedAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId },
      {
        $set: {
          ...filteredUpdateData,
          updatedBy: req.headers?.userid || "",
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!updatedAppointment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Failed to update appointment" });
    }

    return res.status(200).json({
      status: "success",
      message: "Appointment updated successfully",
      appointmentDetails: updatedAppointment,
    });
  } catch (err) {
    return res
      .status(500)
      .json({
        status: "fail",
        message: `Internal server error: ${err.message}`,
      });
  }
};

exports.getTodayAppointmentCount = async (req, res) => {
  const doctorId = req.query.doctorId || req.headers.userid;
  try {
    // Get today's and yesterday's dates in IST
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to midnight IST
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    // Today's stats
    const todaysAppointments = await appointmentModel.find({
      doctorId,
      appointmentDate: {
        $gte: today,
        $lt: tomorrow,
      },
    });

    // Yesterday's stats
    const yesterdaysAppointments = await appointmentModel.find({
      doctorId,
      appointmentDate: {
        $gte: yesterday,
        $lt: today,
      },
    });

    // 1. Today's total appointments count (new + followup)
    const totalAppointmentsToday = todaysAppointments.length;

    // 2. New appointments count (New-Walkin or New-Homecare)
    const newAppointmentsToday = todaysAppointments.filter(
      (app) =>
        app.appointmentType.toLowerCase() === "new-walkin" ||
        app.appointmentType.toLowerCase() === "new-homecare"
    ).length;

    // 3. Follow-up appointments count (Followup-Walkin, Followup-Video, Followup-Homecare)
    const followupAppointmentsToday = todaysAppointments.filter(
      (app) =>
        app.appointmentType.toLowerCase() === "followup-walkin" ||
        app.appointmentType.toLowerCase() === "followup-video" ||
        app.appointmentType.toLowerCase() === "followup-homecare"
    ).length;

    // Yesterday's counts for percentage calculation
    const totalAppointmentsYesterday = yesterdaysAppointments.length;
    const newAppointmentsYesterday = yesterdaysAppointments.filter(
      (app) =>
        app.appointmentType.toLowerCase() === "new-walkin" ||
        app.appointmentType.toLowerCase() === "new-homecare"
    ).length;
    const followupAppointmentsYesterday = yesterdaysAppointments.filter(
      (app) =>
        app.appointmentType.toLowerCase() === "followup-walkin" ||
        app.appointmentType.toLowerCase() === "followup-video" ||
        app.appointmentType.toLowerCase() === "followup-homecare"
    ).length;

    // Calculate percentage change
    const calculatePercentageChange = (todayCount, yesterdayCount) => {
      if (yesterdayCount === 0) {
        return todayCount > 0 ? 100 : 0;
      }
      return (((todayCount - yesterdayCount) / yesterdayCount) * 100).toFixed(
        2
      );
    };

    const totalPercentageChange = calculatePercentageChange(
      totalAppointmentsToday,
      totalAppointmentsYesterday
    );
    const newPercentageChange = calculatePercentageChange(
      newAppointmentsToday,
      newAppointmentsYesterday
    );
    const followupPercentageChange = calculatePercentageChange(
      followupAppointmentsToday,
      followupAppointmentsYesterday
    );

    // Format date in IST (YYYY-MM-DD)
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    // Prepare result
    const result = {
      doctorId,
      date: formatDate(today), // Use local date formatting
      totalAppointments: {
        today: totalAppointmentsToday,
        percentageChange: parseFloat(totalPercentageChange),
      },
      newAppointments: {
        today: newAppointmentsToday,
        percentageChange: parseFloat(newPercentageChange),
      },
      followupAppointments: {
        today: followupAppointmentsToday,
        percentageChange: parseFloat(followupPercentageChange),
      },
    };

    // console.log(JSON.stringify(result, null, 2));
    return res.status(200).json({ status: "success", data: result });
  } catch (err) {
    return res
      .status(500)
      .json({
        status: "fail",
        message: `Internal server error: ${err.message}`,
      });
  }
};

exports.getAppointmentsByDoctorID2 = async (req, res) => {
  try {
    const doctorId = req.query.doctorId || req.headers.userid;
    const { type } = req.params;
    const { date } = req.query;

    // Validate doctorId
    if (!doctorId) {
      return res.status(400).json({
        status: "fail",
        message: "Doctor ID is required in headers",
      });
    }

    // Build query
    const query = { doctorId, isDeleted: { $ne: true } };
    if (type === "appointment") {
      query.appointmentStatus = {
        $in: ["scheduled", "rescheduled", "cancelled"],
      };
    } else if (type === "dashboardAppointment") {
      query.appointmentStatus = {
        $in: ["scheduled", "rescheduled", "cancelled", "completed"],
      };
    } else {
      query.appointmentStatus = "completed";
    }

    if (date) {
      const startOfDay = moment
        .tz(date, "YYYY-MM-DD", "Asia/Kolkata")
        .startOf("day")
        .toDate();
      const endOfDay = moment
        .tz(date, "YYYY-MM-DD", "Asia/Kolkata")
        .endOf("day")
        .toDate();
      query.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
    }

    // Find appointments
    const appointments = await appointmentModel
      .find(query)
      .sort({ appointmentDate: -1 });

    return res.status(200).json({
      status: "success",
      message: "Appointments retrieved successfully",
      data: appointments,
    });
  } catch (error) {
    console.error("Error in getAppointmentsByDoctorID:", error);
    return res.status(500).json({
      status: "fail",
      message: error.message || "Internal server error",
    });
  }
};

exports.getAppointmentsByDoctorID2 = async (req, res) => {
  try {
    const doctorId = req.query.doctorId || req.headers.userid;
    const { type } = req.params;
    // const { date } = req.query;
    const {
      date,
      searchText,
      clinic,
      appointmentType,
      status,
      page = 1,
      limit = 5,
    } = req.query;

    // Validate doctorId
    if (!doctorId) {
      return res.status(400).json({
        status: "fail",
        message: "Doctor ID is required in headers",
      });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid page or limit parameters",
      });
    }

    // Build query
    const query = { doctorId, isDeleted: { $ne: true } };
    if (type === "appointment") {
      query.appointmentStatus = {
        $in: ["scheduled", "rescheduled", "cancelled"],
      };
    } else if (type === "dashboardAppointment") {
      query.appointmentStatus = {
        $in: ["scheduled", "rescheduled", "cancelled", "completed"],
      };
    } else {
      query.appointmentStatus = "completed";
    }

    if (date) {
      const startOfDay = moment
        .tz(date, "YYYY-MM-DD", "Asia/Kolkata")
        .startOf("day")
        .toDate();
      const endOfDay = moment
        .tz(date, "YYYY-MM-DD", "Asia/Kolkata")
        .endOf("day")
        .toDate();
      query.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
    }

    // Clinic (appointmentDepartment) filter
    if (clinic && clinic !== "all") {
      query.appointmentDepartment = clinic;
    }

    // Appointment type filter
    if (appointmentType && appointmentType !== "all") {
      query.appointmentType = appointmentType;
    }

    // Status filter
    if (status && status !== "all") {
      query.appointmentStatus = status;
    }

    // Search text filter (patientName, appointmentId, email, mobile)
    if (searchText) {
      const userIds = [];
      // Fetch users matching searchText for name, email, or mobile
      try {
        const userServiceUrl =
          process.env.USER_SERVICE_URL || "http://localhost:4002";
        const userResponse = await axios.post(
          `${userServiceUrl}/users/searchUsers`,
          {
            searchText,
          },
          {
            headers: {
              "Content-Type": "application/json",
              // Add authorization headers if needed
              // 'Authorization': `Bearer ${req.headers.authorization}`
            },
          }
        );
        if (userResponse.data.status === "success") {
          userIds.push(...userResponse.data.data.map((user) => user.userId));
        }
      } catch (error) {
        console.error("Error searching users:", error.message);
      }

      // Build search query
      query.$or = [
        { patientName: { $regex: searchText, $options: "i" } },
        { appointmentId: { $regex: searchText, $options: "i" } },
        { appointmentId: searchText },
        { userId: { $regex: searchText, $options: "i" } },

        { userId: searchText },
        { userId: { $in: userIds } }, // Matches users from search
      ];
    }

    // Calculate pagination
    const skip = (pageNum - 1) * limitNum;
    const totalAppointments = await appointmentModel.countDocuments(query);
    const totalPages = Math.ceil(totalAppointments / limitNum);

    // Find appointments
    const appointments = await appointmentModel
      .find(query)
      .sort({ createdAt: -1, appointmentDate: -1 })
      .skip(skip)
      .limit(limitNum);

    // Extract userIds from appointments
    const userIds = [...new Set(appointments.map((app) => app.userId))]; // Unique userIds

    // Fetch user details from User service
    let users = [];
    if (userIds.length > 0) {
      try {
        const userServiceUrl =
          process.env.USER_SERVICE_URL || "http://localhost:4002";
        const response = await axios.post(
          `${userServiceUrl}/users/getUsersDetailsByIds`,
          { userIds },
          {
            headers: {
              "Content-Type": "application/json",
              // Add authorization headers if needed
              // 'Authorization': `Bearer ${req.headers.authorization}`
            },
          }
        );
        if (response.data.status === "success") {
          users = response.data.data;
        } else {
          console.error("Failed to fetch user details:", response.data.message);
        }
      } catch (error) {
        console.error(
          "Error fetching user details from User service:",
          error.message
        );
      }
    }

    // Fetch e-prescriptions for completed appointments
    let prescriptions = [];
    if (
      query.appointmentStatus === "completed" ||
      query.appointmentStatus.$in?.includes("completed")
    ) {
      const appointmentIds = appointments
        .filter((app) => app.appointmentStatus === "completed")
        .map((app) => app.appointmentId);

      if (appointmentIds.length > 0) {
        try {
          const userServiceUrl =
            process.env.USER_SERVICE_URL || "http://localhost:4002";
          const response = await axios.post(
            `${userServiceUrl}/pharmacy/getPrescriptionsByAppointmentIds`,
            { appointmentIds },
            {
              headers: {
                "Content-Type": "application/json",
                // Add authorization headers if needed
                // 'Authorization': `Bearer ${req.headers.authorization}`
              },
            }
          );
          if (response.data.status === "success") {
            prescriptions = response.data.data;
          } else {
            console.error(
              "Failed to fetch ePrescription details:",
              response.data.message
            );
          }
        } catch (error) {
          console.error(
            "Error fetching ePrescription details from User service:",
            error.message
          );
        }
      }
    }

    // Map appointments with user details
    const enrichedAppointments = appointments.map((appointment) => {
      const user = users.find((u) => u.userId === appointment.userId) || {};
      const prescription =
        prescriptions.find(
          (p) => p.appointmentId === appointment.appointmentId
        ) || null;
      return {
        ...appointment._doc, // Spread appointment document
        patientDetails: {
          patientName:
            appointment.patientName ||
            `${user.firstname || ""} ${user.lastname || ""}`.trim(),
          dob: user.DOB || null,
          mobile: user.mobile || null,
          gender: user.gender || null,
          age: user.age || null,
        },
        ePrescription: prescription
          ? {
              prescriptionId: prescription.prescriptionId,
              patientInfo: prescription.patientInfo,
              vitals: prescription.vitals,
              diagnosis: prescription.diagnosis,
              advice: prescription.advice,
              createdAt: prescription.createdAt,
              updatedAt: prescription.updatedAt,
            }
          : null,
      };
    });

    return res.status(200).json({
      status: "success",
      message: "Appointments retrieved successfully",
      data: {
        appointments: enrichedAppointments,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalItems: totalAppointments,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error("Error in getAppointmentsByDoctorID:", error);
    return res.status(500).json({
      status: "fail",
      message: error.message || "Internal server error",
    });
  }
};

exports.getAppointmentsByDoctorID = async (req, res) => {
  try {
    const doctorId = req.query.doctorId || req.headers.userid;
    const { type } = req.params;
    const {
      date,
      searchText,
      clinic,
      appointmentType,
      status,
      page = 1,
      limit = 5,
    } = req.query;

    if (!doctorId) {
      return res.status(400).json({
        status: "fail",
        message: "Doctor ID is required in headers",
      });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid page or limit parameters",
      });
    }

    // ✅ Build query once
    const query = { doctorId, isDeleted: { $ne: true } };

    if (type === "appointment") {
      query.appointmentStatus = { $in: ["scheduled", "rescheduled", "cancelled"] };
    } else if (type === "dashboardAppointment") {
      query.appointmentStatus = { $in: ["scheduled", "rescheduled", "cancelled", "completed"] };
    } else {
      query.appointmentStatus = "completed";
    }

    if (date) {
      const startOfDay = moment.tz(date, "YYYY-MM-DD", "Asia/Kolkata").startOf("day").toDate();
      const endOfDay = moment.tz(date, "YYYY-MM-DD", "Asia/Kolkata").endOf("day").toDate();
      query.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
    }

    if (clinic && clinic !== "all") query.appointmentDepartment = clinic;
    if (appointmentType && appointmentType !== "all") query.appointmentType = appointmentType;
    if (status && status !== "all") query.appointmentStatus = status;

    // ✅ Search Text Optimization
    let userIdsFromSearch = [];
    if (searchText) {
      const userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:4002";

      // fire & forget, don’t block main query
      const userSearchPromise = axios
        .post(`${userServiceUrl}/users/searchUsers`, { searchText }, { headers: { "Content-Type": "application/json" } })
        .then((res) => (res.data.status === "success" ? res.data.data.map((u) => u.userId) : []))
        .catch((err) => {
          console.error("Error searching users:", err.message);
          return [];
        });

      userIdsFromSearch = await userSearchPromise;

      query.$or = [
        { patientName: { $regex: searchText, $options: "i" } },
        { appointmentId: { $regex: searchText, $options: "i" } },
        { appointmentId: searchText },
        { userId: { $regex: searchText, $options: "i" } },
        { userId: searchText },
        ...(userIdsFromSearch.length > 0 ? [{ userId: { $in: userIdsFromSearch } }] : []),
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    // ✅ Use Promise.all to fetch count + data together
    const [totalAppointments, appointments] = await Promise.all([
      appointmentModel.countDocuments(query),
      appointmentModel
        .find(query)
        .sort({ createdAt: -1, appointmentDate: -1 })
        .skip(skip)
        .limit(limitNum),
    ]);

    const totalPages = Math.ceil(totalAppointments / limitNum);

    // ✅ Parallel external calls
    const userIds = [...new Set(appointments.map((app) => app.userId))];

    const userServiceUrl = process.env.USER_SERVICE_URL || "http://localhost:4002";
    const [users, prescriptions] = await Promise.all([
      userIds.length
        ? axios
            .post(`${userServiceUrl}/users/getUsersDetailsByIds`, { userIds }, { headers: { "Content-Type": "application/json" } })
            .then((res) => (res.data.status === "success" ? res.data.data : []))
            .catch((err) => {
              console.error("Error fetching user details:", err.message);
              return [];
            })
        : [],
      (query.appointmentStatus === "completed" || query.appointmentStatus?.$in?.includes("completed"))
        ? (() => {
            const appointmentIds = appointments.filter((a) => a.appointmentStatus === "completed").map((a) => a.appointmentId);
            if (appointmentIds.length === 0) return [];
            return axios
              .post(`${userServiceUrl}/pharmacy/getPrescriptionsByAppointmentIds`, { appointmentIds }, { headers: { "Content-Type": "application/json" } })
              .then((res) => (res.data.status === "success" ? res.data.data : []))
              .catch((err) => {
                console.error("Error fetching prescriptions:", err.message);
                return [];
              });
          })()
        : [],
    ]);

    // ✅ Map once
    const enrichedAppointments = appointments.map((appointment) => {
      const user = users.find((u) => u.userId === appointment.userId) || {};
      const prescription = prescriptions.find((p) => p.appointmentId === appointment.appointmentId) || null;

      return {
        ...appointment._doc,
        patientDetails: {
          patientName:
            appointment.patientName || `${user.firstname || ""} ${user.lastname || ""}`.trim(),
          dob: user.DOB || null,
          mobile: user.mobile || null,
          gender: user.gender || null,
          age: user.age || null,
        },
        ePrescription: prescription
          ? {
              prescriptionId: prescription.prescriptionId,
              patientInfo: prescription.patientInfo,
              vitals: prescription.vitals,
              diagnosis: prescription.diagnosis,
              advice: prescription.advice,
              createdAt: prescription.createdAt,
              updatedAt: prescription.updatedAt,
            }
          : null,
      };
    });

    return res.status(200).json({
      status: "success",
      message: "Appointments retrieved successfully",
      data: {
        appointments: enrichedAppointments,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalItems: totalAppointments,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error("Error in getAppointmentsByDoctorID:", error);
    return res.status(500).json({
      status: "fail",
      message: error.message || "Internal server error",
    });
  }
};


exports.getAppointmentsCountByDoctorID2 = async (req, res) => {
  try {
    const doctorId = req.query.doctorId || req.headers.userid;
    const { startDate, endDate } = req.query;

    // Validate doctorId
    if (!doctorId) {
      return res.status(400).json({
        status: "fail",
        message: "Doctor ID is required in headers",
      });
    }

    // Check dates if provided
    let dateFilter = {};
    if (startDate && endDate) {
      // Validate dates
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({
          status: "fail",
          message: "Invalid date format",
        });
      }
      if (start > end) {
        return res.status(400).json({
          status: "fail",
          message: "Start date cannot be after end date",
        });
      }
      dateFilter = {
        appointmentDate: { $gte: start, $lte: end },
      };
    }

    // Build query
    const baseQuery = { doctorId, isDeleted: { $ne: true }, ...dateFilter };

    // Count by status
    const rescheduledCount = await appointmentModel.countDocuments({
      ...baseQuery,
      appointmentStatus: "rescheduled",
    });
    const scheduledCount = await appointmentModel.countDocuments({
      ...baseQuery,
      appointmentStatus: "scheduled",
    });
    const cancelledCount = await appointmentModel.countDocuments({
      ...baseQuery,
      appointmentStatus: "cancelled",
    });
    const completedCount = await appointmentModel.countDocuments({
      ...baseQuery,
      appointmentStatus: "completed",
    });
    const totalCount = await appointmentModel.countDocuments({
      ...baseQuery,
      appointmentStatus: {
        $in: ["scheduled", "rescheduled", "cancelled", "completed"],
      },
    });

    return res.status(200).json({
      status: "success",
      message: "Appointments counts retrieved successfully",
      data: {
        total: totalCount,
        scheduled: scheduledCount,
        rescheduled: rescheduledCount,
        cancelled: cancelledCount,
        completed: completedCount,
      },
    });
  } catch (error) {
    console.error("Error in getAppointmentsByDoctorID:", error);
    return res.status(500).json({
      status: "fail",
      message: error.message || "Internal server error",
    });
  }
};

exports.getAppointmentsCountByDoctorID = async (req, res) => {
  try {
    const doctorId = req.query.doctorId || req.headers.userid;
    const { startDate, endDate } = req.query;

    if (!doctorId) {
      return res.status(400).json({
        status: "fail",
        message: "Doctor ID is required in headers",
      });
    }

    // Date filter
    let dateFilter = {};
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start) || isNaN(end)) {
        return res.status(400).json({
          status: "fail",
          message: "Invalid date format",
        });
      }
      if (start > end) {
        return res.status(400).json({
          status: "fail",
          message: "Start date cannot be after end date",
        });
      }
      dateFilter = {
        appointmentDate: { $gte: start, $lte: end },
      };
    }

    const matchQuery = {
      doctorId,
      isDeleted: { $ne: true },
      ...dateFilter,
      appointmentStatus: {
        $in: ["scheduled", "rescheduled", "cancelled", "completed"],
      },
    };

    const counts = await appointmentModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$appointmentStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    // Build response
    const countsMap = counts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const scheduled = countsMap["scheduled"] || 0;
    const rescheduled = countsMap["rescheduled"] || 0;
    const cancelled = countsMap["cancelled"] || 0;
    const completed = countsMap["completed"] || 0;
    const total = scheduled + rescheduled + cancelled + completed;

    return res.status(200).json({
      status: "success",
      message: "Appointments counts retrieved successfully",
      data: {
        total,
        scheduled,
        rescheduled,
        cancelled,
        completed,
      },
    });
  } catch (error) {
    console.error("Error in getAppointmentsByDoctorID:", error);
    return res.status(500).json({
      status: "fail",
      message: error.message || "Internal server error",
    });
  }
};

exports.getAppointment = async (req, res) => {
  try {
    let appointmentId = req.query?.appointmentId;
    const appointment = await appointmentModel.findOne({
      appointmentId: appointmentId,
    });
    return res.status(200).json({
      status: "success",
      message: "Appointment retrieved successfully",
      data: appointment,
    });
  } catch (error) {
    return res.status(500).json({
      status: "fail",
      message: "Error retrieving appointment",
      error: error.message,
    });
  }
};

exports.getAppointmentsByDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientId } = req.query;

    // Validate doctorId and userId
    if (!doctorId) {
      return res.status(400).json({ error: "Invalid Doctor ID or User ID" });
    }

    // Build query dynamically
    const query = {
      doctorId,
      appointmentStatus: { $ne: "cancelled" }, // Exclude cancelled appointments
    };

    if (patientId) {
      query.userId = patientId;
    }

    // Fetch appointments for the doctor and user
    const appointments = await appointmentModel
      .find(query)
      .select(
        "appointmentId userId doctorId appointmentType appointmentDate appointmentTime appointmentStatus createdAt _id addressId"
      );

    // If no appointments found
    if (!appointments || appointments.length === 0) {
      return res
        .status(404)
        .json({ message: "No appointments found for this doctor and patient" });
    }
    console.log("appointments===", appointments);
    // Return the appointments
    return res.status(200).json({
      success: true,
      data: appointments,
    });
  } catch (error) {
    console.error("Error fetching appointments by doctor and user:", error);
    return res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
};

exports.getAllFamilyAppointments = async (req, res) => {
  try {
    // Step 1: Get userId from headers or params
    const userId = req.params?.userId || req.headers?.userid;
    const status = req.query.status;

    if (!userId) {
      return res.status(400).json({
        status: "fail",
        message: "userId is required in headers or params",
      });
    }

    // Step 2: Fetch users where familyProvider matches userId or userId matches
    const userServiceUrl =
      process.env.USER_SERVICE_URL || "http://localhost:4002";
    const userResponse = await axios.get(`${userServiceUrl}/users/getUserIds`, {
      params: {
        $or: [{ familyProvider: userId }, { userId: userId }],
        isDeleted: false, // Exclude deleted users
      },
      headers: {
        "Content-Type": "application/json",
        // Add authorization headers if needed
        // 'Authorization': `Bearer ${req.headers.authorization}`
      },
    });

    if (
      !userResponse.data ||
      !userResponse.data.data ||
      userResponse.data.data.length === 0
    ) {
      return res.status(404).json({
        status: "fail",
        message: "No users found for this family provider",
      });
    }

    // Step 3: Extract userIds from the response
    const userIds = userResponse.data.data.map((user) => user.userId);

    // Step 4: Fetch appointments for the list of userIds
    const query = { userId: { $in: userIds } };

    // Add appointmentStatus filter if provided
    if (status) {
      // Validate status against allowed values from appointmentSchema
      const validStatuses = [
        "pending",
        "scheduled",
        "completed",
        "cancelled",
        "rescheduled",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          status: "fail",
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
      }
      query.appointmentStatus = status;
    }

    const appointmentResponse = await appointmentModel.find(query);

    if (!appointmentResponse || appointmentResponse.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No appointments found for the family members",
        data: [],
      });
    }

    // Step 5: Combine user details with appointments for better context (optional)
    const appointments = appointmentResponse.map((appointment) => {
      const user = userResponse.data.data.find(
        (u) => u.userId === appointment.userId
      );
      return {
        ...appointment.toObject(), // Convert Mongoose document to plain object
        patientName: user
          ? `${user.firstname} ${user.lastname || ""}`.trim()
          : appointment.patientName,
      };
    });

    // Step 6: Return the response
    return res.status(200).json({
      status: "success",
      message: "Appointments retrieved successfully",
      data: appointments,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Error retrieving appointments",
      error: error.message,
    });
  }
};

exports.getAppointmentDataByUserIdAndDoctorId = async (req, res) => {
  try {
    const doctorId = req.query.doctorId;
    const userId = req.query.userId;

    if (!doctorId || !userId) {
      return res.status(400).json({
        status: "fail",
        message: "doctorId and userId are required",
      });
    }

    // Fetch the latest appointment
    const latestAppointment = await appointmentModel
      .findOne({
        doctorId,
        userId,
      })
      .sort({ appointmentDate: -1, appointmentTime: -1 })
      .lean();

    if (!latestAppointment) {
      return res.status(404).json({
        status: "fail",
        message: "No appointment found",
      });
    }

    res.status(200).json({
      status: "success",
      data: latestAppointment,
    });
  } catch (error) {
    console.error("Error fetching latest appointment:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Internal Server Error",
    });
  }
};

exports.getAllFamilyDoctors = async (req, res) => {
  try {
    // Step 1: Get userIds from headers or params
    // Step 1: Get userIds from query string
    let { userIds } = req.query;

    if (!userIds) {
      return res.status(400).json({
        status: "fail",
        message: "userIds are required",
      });
    }

    const appointments = await appointmentModel.find(
      { userId: { $in: userIds } },
      { doctorId: 1, _id: 0 }
    );

    const doctorIds = [...new Set(appointments.map((a) => a.doctorId))];

    return res.status(200).json({
      status: "success",
      message: "Family doctors retrieved successfully",
      data: doctorIds || [],
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Error retrieving family doctors",
      error: error.message,
    });
  }
};

exports.checkPatientConsultedDoctor = async (req, res) => {
   try {
    const { userId, doctorId, appointmentId } = req.query;

    // Validate input
    if (!userId || !doctorId || !appointmentId) {
      return res.status(400).json({
        status: 'fail',
        message: 'userId, doctorId, and appointmentId are required'
      });
    }

    // Check for completed appointments
    const appointment = await appointmentModel.findOne({
       appointmentId,
      userId,
      doctorId,
      appointmentStatus: 'completed' // Only count completed appointments
    });

    res.status(200).json({
      status: 'success',
      hasAppointment: !!appointment
    });
  } catch (error) {
    console.error('Error checking appointment:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error checking appointment status',
      error: error.message
    });
  }
}