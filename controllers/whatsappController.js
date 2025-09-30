import DoctorSlotModel from "../models/doctorSlotsModel.js";
import doctorSlotSchema from "../schemas/doctorSlotsSchema.js";
import generateSlots from "../utils/generateTimeSlots.js";
import { sortSlotsByTime } from "../utils/utils.js";
import Joi from "joi";
import axios from "axios";

// If you use Buffer, import it from 'buffer'
import { Buffer } from "buffer";

import { v4 as uuidv4 } from "uuid";
import e from "express";
import { error } from "console";
import wtspAppointmentSchema from "../schemas/wtspAppointmentSchema.js";
import appointmentsModel from "../models/appointmentsModel.js";
import { SEQUENCE_PREFIX } from "../utils/constants.js";
import sequenceSchema from "../sequence/sequenceSchema.js";
import appointmentModel from "../models/appointmentsModel.js";
import { PLATFORM_FEE } from "../utils/fees.js";
import moment from "moment-timezone";
import {
  createPayment,
  createWhatsAppPayment,
  updateWhatsAppPaymentStatus,
} from "../services/paymentService.js";
import winstonLogger from "../utils/winstonLogger.js";
// import { winstonLogger } from "../utils/winstonLogger.js";

// Duplicate API for WhatsApp integration
export const getSlotsByDoctorIdAndDateForWhatsapp = async (req, res) => {
  const { doctorId, date, addressId } = req.query;
  if (!doctorId || !date || !addressId) {
    return res.status(400).json({
      status: "fail",
      message: "doctorId, date, and addressId are required",
    });
  }
  const slotDate = new Date(date);
  const slots = await DoctorSlotModel.findOne({
    doctorId,
    addressId,
    date: slotDate,
  });
  if (slots && Array.isArray(slots.slots)) {
    // Only keep slots with status 'available' and time greater than now if date is today
    const now = new Date();
    const isToday =
      slotDate.getFullYear() === now.getFullYear() &&
      slotDate.getMonth() === now.getMonth() &&
      slotDate.getDate() === now.getDate();

    slots.slots = slots.slots.filter((slot) => {
      if (slot.status !== "available") return false;
      if (isToday) {
        // slot.time is assumed to be in "HH:mm" format
        const [slotHour, slotMinute] = slot.time.split(":").map(Number);
        const slotDateTime = new Date(slotDate);
        slotDateTime.setHours(slotHour, slotMinute, 0, 0);
        return slotDateTime > now;
      }
      return true;
    });
  }
  if (!slots) {
    return res.status(404).json({
      status: "fail",
      message: "No slots found for this doctor on the specified date",
    });
  }
  return res.status(200).json({ status: "success", data: slots });
};

const AIRTEL_API_URL =
  "https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/send/text";

const FROM_NUMBER = 919666955501;
const AIRTEL_TOKEN = 'T7W9&w3396Y"';

// 🔄 Webhook to receive incoming messages from Airtel
const sessions = {};

const vydhyobot = async (body) => {
  const { sourceAddress: from, messageParameters } = body;
  if (!from || !messageParameters?.text?.body) return;

  const text = messageParameters.text.body.trim();
  // Initialize vydhyoSession if not present
  if (!sessions[from]) {
    sessions[from] = {
      items: [],
      selectedCanteen: null,
      canteens: [],
      menus: null,
      selectedMenu: null,
      cities: [],
      city: undefined,
      service: undefined,
      specializations: [],
      specialization: undefined,
      doctors: [],
      doctor: undefined,
      doctorId: undefined,
      clinics: [],
      clinic: undefined,
      addressId: undefined,
      dates: [],
      date: undefined,
      slots: [],
      slot: undefined,
      stage: undefined,
      cart: [],
      selectedDate: undefined,
    };
  }
  const vydhyoSession = sessions[from];
  let reply = "";

  // 1. City selection
  // Always allow "hi" to restart the session
  if (text.toLowerCase() === "hi") {
    // Reset session
    sessions[from] = {
      items: [],
      selectedCanteen: null,
      canteens: [],
      menus: null,
      selectedMenu: null,
      cities: [],
      city: undefined,
      service: undefined,
      specializations: [],
      specialization: undefined,
      doctors: [],
      doctor: undefined,
      doctorId: undefined,
      clinics: [],
      clinic: undefined,
      addressId: undefined,
      dates: [],
      date: undefined,
      slots: [],
      slot: undefined,
      stage: "city_selection",
      cart: [],
      selectedDate: undefined,
    };
    const vydhyoSession = sessions[from];
    try {
      const { data } = await axios.get(
        "https://server.vydhyo.com/whatsapp/cities"
      );
      vydhyoSession.cities = Array.isArray(data?.data) ? data.data : [];
      if ((vydhyoSession.cities ?? []).length > 0) {
        reply = `👋 Welcome to Vydhyo! Please select your city:\n${(
          vydhyoSession.cities ?? []
        )
          .map((city, i) => `${i + 1}) ${city}`)
          .join("\n")}`;
      } else {
        reply = `❌ No cities found. Please try again later.`;
      }
    } catch {
      reply = `❌ No cities found. Please try again later.`;
    }
  } else if (!vydhyoSession.city) {
    if (
      vydhyoSession.cities &&
      Number(text) >= 1 &&
      Number(text) <= vydhyoSession.cities.length
    ) {
      vydhyoSession.city = vydhyoSession.cities[Number(text) - 1];
      vydhyoSession.stage = "specialization_selection";
      // Get specializations for city
      try {
        const { data } = await axios.get(
          `https://server.vydhyo.com/whatsapp/specializations`
        );
        vydhyoSession.specializations = Array.isArray(data?.data)
          ? data.data
          : [];
        if ((vydhyoSession.specializations ?? []).length > 0) {
          reply = `You selected ${
            vydhyoSession.city
          }. Please select a specialization:\n${(
            vydhyoSession.specializations ?? []
          )
            .map((s, i) => `${i + 1}) ${s}`)
            .join("\n")}`;
        } else {
          reply = `❌ No specializations found`;
        }
      } catch {
        reply = `❌ No specializations found. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please type 'Hi' to start or select a valid city number.`;
    }
  }
  // 2. Specialization selection
  else if (!vydhyoSession.specialization) {
    if (
      vydhyoSession.specializations &&
      Number(text) >= 1 &&
      Number(text) <= vydhyoSession.specializations.length
    ) {
      vydhyoSession.specialization =
        vydhyoSession.specializations[Number(text) - 1];
      vydhyoSession.stage = "doctor_selection";
      // Get doctors for city & specialization
      try {
        const { data } = await axios.get(
          `https://server.vydhyo.com/whatsapp/doctors-by-specialization-city?city=${encodeURIComponent(
            vydhyoSession.city
          )}&specialization=${encodeURIComponent(vydhyoSession.specialization)}`
        );
        vydhyoSession.doctors = Array.isArray(data?.data) ? data.data : [];
        if ((vydhyoSession.doctors ?? []).length > 0) {
          reply = `You selected ${
            vydhyoSession.specialization
          }. Please select a doctor:\n${(vydhyoSession.doctors ?? [])
            .map((d, i) => `${i + 1}) ${d.firstname} ${d.lastname}`)
            .join("\n")}`;
        } else {
          reply = `❌ No doctors found for ${vydhyoSession.specialization} in ${vydhyoSession.city}.`;
        }
      } catch (error) {
        reply = `❌ No doctors found. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please select a valid specialization number:\n${vydhyoSession.specializations
        ?.map((s, i) => `${i + 1}) ${s}`)
        .join("\n")}`;
    }
  }
  // 3. Doctor selection
  else if (!vydhyoSession.doctor) {
    if (
      vydhyoSession.doctors &&
      Number(text) >= 1 &&
      Number(text) <= vydhyoSession.doctors.length
    ) {
      vydhyoSession.doctor = vydhyoSession.doctors[Number(text) - 1];
      vydhyoSession.doctorId = vydhyoSession.doctor.userId;
      // Get clinics for doctor & city
      try {
        const { data } = await axios.get(
          `https://server.vydhyo.com/whatsapp/doctor-clinics?userId=${
            vydhyoSession.doctorId
          }&city=${encodeURIComponent(vydhyoSession.city)}`
        );
        vydhyoSession.clinics = Array.isArray(data?.data) ? data.data : [];
        if ((vydhyoSession.clinics ?? []).length > 0) {
          reply = `You selected ${vydhyoSession.doctor.firstname} ${
            vydhyoSession.doctor.lastname
          }. Please select a clinic:\n${(vydhyoSession.clinics ?? [])
            .map((c, i) => `${i + 1}) ${c.clinicName}`)
            .join("\n")}`;
          vydhyoSession.stage = "clinic_selection";
        } else {
          reply = `❌ No clinics found for ${vydhyoSession.doctor.firstname} ${vydhyoSession.doctor.lastname} in ${vydhyoSession.city}.`;
        }
      } catch {
        reply = `❌ No clinics found. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please select a valid doctor number:\n${vydhyoSession.doctors
        ?.map((d, i) => `${i + 1}) ${d.firstname} ${d.lastname}`)
        .join("\n")}`;
    }
  }
  // 4. Clinic selection
  else if (!vydhyoSession.clinic) {
    if (
      vydhyoSession.clinics &&
      Number(text) >= 1 &&
      Number(text) <= vydhyoSession.clinics.length
    ) {
      vydhyoSession.clinic = vydhyoSession.clinics[Number(text) - 1];
      vydhyoSession.addressId = vydhyoSession.clinic.addressId;

      // Generate today + next 3 days
      const dates = [];
      for (let i = 0; i < 4; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        dates.push({
          key: `${yyyy}-${mm}-${dd}`,
          display: `${dd}-${mm}-${yyyy}`,
        });
      }
      vydhyoSession.dates = dates.map((date) => date.key);

      reply = `You selected clinic: ${
        vydhyoSession.clinic.clinicName
      }\nPlease select a date:\n${dates
        .map((date, i) => `${i + 1}) ${date.display}`)
        .join("\n")}`;
      vydhyoSession.stage = "date_selection";
    } else {
      reply = `❓ I didn't understand that. Please select a valid clinic number:\n${vydhyoSession.clinics
        ?.map((c, i) => `${i + 1}) ${c.clinicName}`)
        .join("\n")}`;
    }
  }
  // 5. Date selection
  else if (!vydhyoSession.date) {
    if (
      vydhyoSession.dates &&
      Number(text) >= 1 &&
      Number(text) <= vydhyoSession.dates.length
    ) {
      vydhyoSession.date = vydhyoSession.dates[Number(text) - 1];
      // Get slots for doctorId, addressId, date
      try {
        const { data } = await axios.get(
          `https://server.vydhyo.com/whatsappbooking/getSlotsByDoctorIdAndDateForWhatsapp?doctorId=${
            vydhyoSession.doctorId
          }&addressId=${vydhyoSession.addressId}&date=${encodeURIComponent(
            vydhyoSession.date
          )}`
        );
        // Only keep slots with status 'available' and map to their time
        vydhyoSession.slots = Array.isArray(data?.data?.slots)
          ? data.data.slots
              .filter((slot) => slot.status === "available")
              .map((slot) => slot.time)
          : [];
        if ((vydhyoSession.slots ?? []).length > 0) {
          reply = `You selected ${
            vydhyoSession.date
          }. Please select a time slot:\n${(vydhyoSession.slots ?? [])
            .map((s, i) => `${i + 1}) ${s}`)
            .join("\n")}`;
          vydhyoSession.stage = "slot_selection";
        } else {
          reply = `❌ No slots available for this date.`;
        }
      } catch {
        reply = `❌ No slots available. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please select a valid date number:\n${vydhyoSession.dates
        ?.map((d, i) => `${i + 1}) ${d}`)
        .join("\n")}`;
    }
  }
  // 6. Slot selection
  else if (!vydhyoSession.slot) {
    if (
      vydhyoSession.slots &&
      Number(text) >= 1 &&
      Number(text) <= vydhyoSession.slots.length
    ) {
      vydhyoSession.slot = vydhyoSession.slots[Number(text) - 1];
      reply = `You selected ${vydhyoSession.slot}. Confirm your appointment by replying 'Yes'.`;
      vydhyoSession.stage = "confirm";
    } else {
      reply = `❓ I didn't understand that. Please select a valid slot number:\n${vydhyoSession.slots
        ?.map((s, i) => `${i + 1}) ${s}`)
        .join("\n")}`;
    }
  }
  // 7. Confirmation
  else if (vydhyoSession.stage === "confirm" && text.toLowerCase() === "yes") {
    // Confirm appointment (dummy API call)
    try {
      await axios.post("https://server.vydhyo.com/whatsapp/book", {
        city: vydhyoSession.city,
        specialization: vydhyoSession.specialization,
        doctorId: vydhyoSession.doctorId,
        addressId: vydhyoSession.addressId,
        date: vydhyoSession.date,
        slot: vydhyoSession.slot,
        user: from,
      });
      reply = `✅ Appointment confirmed!\n\nDetails:\nCity: ${vydhyoSession.city}\nSpecialization: ${vydhyoSession.specialization}\nDoctor: ${vydhyoSession.doctor.name}\nClinic: ${vydhyoSession.clinic.address}\nDate: ${vydhyoSession.date}\nSlot: ${vydhyoSession.slot}`;
      delete sessions[from];
    } catch {
      reply = `❌ Failed to confirm appointment. Please try again later.`;
    }
  } else {
    reply = `❓ I didn't understand that. Please type 'Hi' to start again.`;
  }

  try {
    await sendWhatsAppMessage(from, reply, FROM_NUMBER.toString(), null);
  } catch (error) {
    console.error("❌ Error sending reply:", error.message);
  }
};
// Your Vydhyobot implementation here

export const sendWhatsAppMessage = async (
  to,
  reply,
  fromNumber,
  base64Image
) => {
  const username = "world_tek";
  const password = 'T7W9&w3396Y"'; // Store in environment variables in production
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  const headers = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };

  const textUrl =
    "https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/send/text";

  const uploadUrl =
    "https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/upload/media";

  const mediaSendUrl =
    "https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/send/media";

  try {
    // 🔹 If no image, send as text message
    if (!base64Image) {
      const textPayload = {
        sessionId: generateUuid(),
        to,
        from: fromNumber,
        message: {
          type: "text",
          text: reply,
        },
      };

      const response = await axios.post(textUrl, textPayload, { headers });
      // console.log('✅ Text message sent:', response.data);
      return response.data;
    }

    // 🔹 Clean base64 data (remove prefix if exists)
    const cleanedBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    // 🔹 Upload image to get mediaId
    const uploadPayload = {
      sessionId: generateUuid(),
      type: "image",
      attachment: {
        base64: cleanedBase64,
        filename: "qr-code.png",
      },
    };

    const uploadRes = await axios.post(uploadUrl, uploadPayload, { headers });
    const mediaId = uploadRes.data.mediaId;

    if (!mediaId) {
      throw new Error("❌ Media upload failed. mediaId not returned.");
    }

    // 🔹 Send image message using mediaId
    const mediaPayload = {
      sessionId: generateUuid(),
      to,
      from: fromNumber,
      message: {
        type: "image",
        image: {
          id: mediaId,
          caption: reply,
        },
      },
    };

    const mediaRes = await axios.post(mediaSendUrl, mediaPayload, { headers });
    // console.log('✅ Image message sent:', mediaRes.data);
    return mediaRes.data;
  } catch (error) {
    console.error(
      "❌ Error sending WhatsApp message:",
      error.response?.data || error.message
    );
    throw error;
  }
};

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
  console.log("result", result);
  return result;
}

const createPaymentLink = async (payment) => {
  try {
    // Cashfree API credentials
    const CASHFREE_APP_ID = process.env.pgAppID;
    const CASHFREE_SECRET_KEY = process.env.pgSecreteKey;
    const CASHFREE_BASE_URL =
      process.env.CASHFREE_BASE_URL || "https://api.cashfree.com/pg";
console.log("CASHFREE_BASE_URL", CASHFREE_BASE_URL);
    // Payload for Cashfree Link API
    const payload = {
      link_id: payment.linkId,
      link_amount: payment.totalAmount,
      link_currency: payment.currency,
      customer_details: {
        customer_name: `${payment.name}`,
        customer_email: payment.email,
        customer_phone: payment.mobile,
      },
      link_meta: {
        return_url: `${process.env.APPLICATION_URL}/paymentResponse?link_id=${payment.linkId}`,
        notify_url: `${process.env.BASE_URL}/whatsappbooking/cashfreecallback`,
      },
      link_notify: {
        send_sms: false,
        send_email: false,
        payment_received: false,
      },
      link_payment_methods: ["upi"], // UPI only
      link_purpose: "Payment",
    };

    console.log("Cashfree link payload:", payload);
    // API request to Cashfree
    const response = await axios.post(`${CASHFREE_BASE_URL}/links`, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": "2023-08-01",
      },
    });
console.log("Cashfree link response:", response);
    if (response.status === 200 && response.data?.link_url) {
      console.log("Cashfree link response:", response.data);
      return response.data.link_url; // ✅ return actual link
    } else {
      console.error("Error creating payment link:", response.data);
      return null;
    }
  } catch (error) {
    console.log("error", error.response?.data || error.message);
    console.error("Error creating payment link:", error);
    return null;
  }
};

export const createWhatsappAppointment = async (req, res) => {
  try {
    // Step 1: Validate Input
    const { error } = wtspAppointmentSchema.validate(req.body);
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
    const checkSlotAvailable = await appointmentsModel.find({
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

    // step 3.1 check this mobile from body user available or not
    const mobile = req.body.mobile;
    const email = req.body.email || "example@example.com";
    // Extract first and last name from patientName
    let firstname = "";
    let lastname = "";

    if (req.body.patientName) {
      // Trim, split by spaces, and remove empty strings
      const parts = req.body.patientName.trim().split(/\s+/);

      firstname = parts[0] || "";
      lastname = parts.length > 1 ? parts.slice(1).join(" ") : "";
    }

    const payload = {
      mobile: mobile,
      userType: "patient",
      status: "active",
      firstname: firstname,
      lastname: lastname,
      userFrom: "whatsapp",
    };

    // check user is avaiable or not if no create user
    const userResponse = await axios.post(
      `${process.env.AUTH_SERVICE_URL}/auth/whatsappuser`,
      payload,
      {
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log("userResponse", userResponse?.data?.user.mobile);

    if (!userResponse?.data?.user || !userResponse?.data?.user?._id) {
      return res.status(500).json({
        status: "fail",
        message: "Something Went Wrong! Please try again later.",
      });
    }

    const userid = userResponse.data.user.userId;
    console.log("userResponseuserid", userid);

    // Step 4: Generate appointmentId first (before calling payment API)
    const appointmentCounter = await sequenceSchema.findByIdAndUpdate(
      { _id: SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.APPOINTMENTS_MODEL },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // Step 5: Create appointment
    const appointmentId = SEQUENCE_PREFIX.APPOINTMENTS_SEQUENCE.SEQUENCE.concat(
      appointmentCounter.seq
    );

    req.body.appointmentId = appointmentId;
    req.body.createdBy = userid || null;
    req.body.updatedBy = userid || null;
    req.body.userId = userid;

    console.log("before book slot", 100);

    // step 5.1: Check if the doctor has slots available for the appointment date and time
    const bookingResult = await bookSlot(req);
    console.log("bookingResult", bookingResult);
    if (!bookingResult || bookingResult.modifiedCount === 0) {
      return res.status(404).json({
        status: "fail",
        message:
          "Slot already booked or slots do not exist check in slot availability.",
      });
    }

    // Generate unique linkId
    const currentDate = new Date();
    const day = String(currentDate.getDate()).padStart(2, "0");
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const year = currentDate.getFullYear();

    const linkId = `live_${day}${month}${year}_${appointmentId}`;
    req.body.linkId = linkId;

    console.log("before appointment creation", linkId);

    const appointment = await appointmentModel.create(req.body);

    // Create the order

    const payment = {
      linkId: linkId,
      totalAmount: req.body.amount,
      currency: "INR",
      name: req.body.patientName,
      mobile: mobile,
      email: email || "example@example.com",
    };

    console.log("payment", payment);

    const paymentLink = await createPaymentLink(payment);

    //if we get paymentLink then create a payment intiated
    let paymentResponse;
    if (paymentLink) {
      paymentResponse = await createWhatsAppPayment({
        userId: userid,
        doctorId: req.body.doctorId,
        addressId: req.body.addressId,
        appointmentId: req.body.appointmentId,
        actualAmount: req.body.amount,
        discount: req.body.discount || 0,
        discountType: req.body.discountType,
        finalAmount: req.body.finalAmount,
        paymentStatus: "pending",
        paymentFrom: "appointment",
        appSource: "whatsapp",
        paymentMethod: "upi",
        linkId: linkId,
        platformFee: PLATFORM_FEE,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Appointment created successfully",
      data: {
        appointmentDetails: appointment,
        appointmentId: req.body.appointmentId,
        platformfee: PLATFORM_FEE,
        paymentLink,
        paymentResponse: paymentResponse,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Error creating appointment",
      error: error.message,
    });
  }
};

export const booking = async (req, res) => {
  // Check if msgStatus is RECEIVED
  if (req.body.msgStatus !== "RECEIVED") {
    // console.log('Ignoring webhook request as msgStatus is not RECEIVED.');
    return res.status(200).json({ message: "Webhook ignored." });
  }

  await vydhyobot(req.body);

  return res.status(200).json({
    status: "success",
    message: "Booking done",
  });
};

// ✅ Cancel doctor slot
async function cancelSlot(appointment, userid) {
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
        "slots.$[elem].updatedBy": userid,
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

  console.log("cancelSlot result:", result);

  if (result.modifiedCount === 0) {
    console.warn(
      `No slot updated for appointmentId=${appointmentId}, doctorId=${doctorId}, time=${appointmentTime}`
    );
  }

  return result;
}

// ✅ Release doctor slot and cancel appointment
const releaseDoctorSlot = async (appointment, reason, userid) => {
  if (!appointment?.doctorId || !appointment?.appointmentId) {
    throw new Error("doctorId and appointmentId are required");
  }

  try {
    await cancelSlot(appointment, userid);

    const updateAppointment = await appointmentModel.findOneAndUpdate(
      { appointmentId: appointment.appointmentId },
      {
        $set: {
          appointmentStatus: "cancelled",
          cancellationReason: reason,
          updatedBy: userid,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!updateAppointment) {
      throw new Error(
        `Failed to update appointment status for ${appointment.appointmentId}`
      );
    }

    return { status: "success", message: "Slot released successfully" };
  } catch (err) {
    console.error("Error in releaseDoctorSlot:", err);
    throw err;
  }
};

// ✅ Payment link details and appointment update
export const CashfreePaymentLinkDetails = async (req, res) => {
  try {
    console.log(req.body, "req.body");
    const { linkId } = req.body;
    console.log("linkId", linkId);
    if (!linkId) {
      return res.status(400).json({
        message: "linkId is required to fetch payment details.",
      });
    }

    const CASHFREE_APP_ID = process.env.pgAppID;
    const CASHFREE_SECRET_KEY = process.env.pgSecreteKey;
    const CASHFREE_BASE_URL =
      process.env.CASHFREE_BASE_URL || "https://sandbox.cashfree.com/pg";

    const response = await axios.get(`${CASHFREE_BASE_URL}/links/${linkId}`, {
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": "2023-08-01",
      },
    });
    console.log("cashfreepaymentresponse", response.data);
    if (response.status === 200 && response.data) {
      const paymentDetails = response.data;

      if (paymentDetails.link_status === "PAID") {
        const paymentResponse = await updateWhatsAppPaymentStatus({
          linkId,
          status: "paid",
        });

        console.log("paymentResponsesuccess", paymentResponse);
        const appointmentId = paymentResponse?.data?.appointmentId;
        console.log("appointmentIdsuccess", appointmentId);

        if (appointmentId) {
          await appointmentModel.findOneAndUpdate(
            { appointmentId },
            { appointmentStatus: "scheduled", updatedAt: new Date() },
            { new: true }
          );
        }
      } else {
        // ❌ Payment not successful → cancel slot and appointment
        const paymentResponse = await updateWhatsAppPaymentStatus({
          linkId,
          status: "cancelled",
        });

        console.log("paymentResponsefail", paymentResponse);

        const appointmentId = paymentResponse?.data?.appointmentId;
        const appointmentData = await appointmentModel.findOne({
          appointmentId,
        });
        console.log("appointmentIdfail", appointmentId);

        if (appointmentData) {
          const userid = appointmentData.userId;
          const reason = "Payment failed";
          await releaseDoctorSlot(appointmentData, reason, userid);
        }
      }

      return res.status(200).json({
        message: "Payment details updated successfully.",
        data: {
          cashfreeDetails: paymentDetails,
        },
      });
    } else {
      // ❌ Payment not successful → cancel slot and appointment
      const paymentResponse = await updateWhatsAppPaymentStatus({
        linkId,
        status: "cancelled",
      });

      console.log("paymentResponsefail", paymentResponse);

      const appointmentId = paymentResponse?.data?.appointmentId;
      const appointmentData = await appointmentModel.findOne({ appointmentId });
      console.log("appointmentIdfail", appointmentId);

      if (appointmentData) {
        const userid = appointmentData.userId;
        const reason = "Payment failed";
        await releaseDoctorSlot(appointmentData, reason, userid);
      }

      return res.status(400).json({
        message: "Failed to fetch payment details from Cashfree.",
        error: response.data,
      });
    }
  } catch (error) {
    console.error(
      "Error fetching or updating payment details from Cashfree:",
      error
    );
    return res.status(500).json({
      message:
        "An error occurred while fetching or updating payment details from Cashfree.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ✅ Cashfree payment callback handler
export const cashfreeCallback = async (
  req,
  res
) => {
  try {
    // Get parameters from either query params (GET) or request body (POST)
    const order_id =
      req.method === "GET" ? req.query.order_id : req.body.order_id;
    const payment_status =
      req.method === "GET" ? req.query.payment_status : req.body.payment_status;
    const payment_amount =
      req.method === "GET" ? req.query.payment_amount : req.body.payment_amount;
    const payment_currency =
      req.method === "GET"
        ? req.query.payment_currency
        : req.body.payment_currency;
    const transaction_id =
      req.method === "GET" ? req.query.transaction_id : req.body.transaction_id;

    // Return a placeholder response for now
    return res.status(statusCodes.SUCCESS).json({
      message: "Callback processed successfully",
      data: {
        order_id,
        payment_status,
        payment_amount,
        payment_currency,
        transaction_id,
      },
    });
  } catch (error) {
    logger.error(
      `Error processing Cashfree callback: ${error instanceof Error ? error.message : error
      }`
    );
    return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      message: getMessage("error.internalServerError"),
    });
  }
};


export const cashfreeCallbackWeb = async (
  req,
  res
) => {
  try {
    // Get parameters from either query params (GET) or request body (POST)
    const order_id =
      req.method === "GET" ? req.query.order_id : req.body.order_id;
    const payment_status =
      req.method === "GET" ? req.query.payment_status : req.body.payment_status;
    const payment_amount =
      req.method === "GET" ? req.query.payment_amount : req.body.payment_amount;
    const payment_currency =
      req.method === "GET"
        ? req.query.payment_currency
        : req.body.payment_currency;
    const transaction_id =
      req.method === "GET" ? req.query.transaction_id : req.body.transaction_id;

    // Return a placeholder response for now
    return res.status(200).json({
      message: "Callback processed successfully",
      data: {
        order_id,
        payment_status,
        payment_amount,
        payment_currency,
        transaction_id,
      },
    });
  } catch (error) {
    winstonLogger.error(
      `Error processing Cashfree callback: ${error instanceof Error ? error.message : error
      }`
    );
    return res.status(500).json({
      message: getMessage("error.internalServerError"),
    });
  }
};


function generateUuid() {
  return uuidv4();
}
