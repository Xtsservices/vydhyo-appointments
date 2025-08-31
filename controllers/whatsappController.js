import DoctorSlotModel from '../models/doctorSlotsModel.js';
import doctorSlotSchema from '../schemas/doctorSlotsSchema.js';
import generateSlots from '../utils/generateTimeSlots.js';
import { sortSlotsByTime } from '../utils/utils.js';
import Joi from 'joi';
import axios from 'axios';

// If you use Buffer, import it from 'buffer'
import { Buffer } from 'buffer';

import { v4 as uuidv4 } from 'uuid';




// Duplicate API for WhatsApp integration
export const getSlotsByDoctorIdAndDateForWhatsapp = async (req, res) => {
  const { doctorId, date, addressId } = req.query;
  if (!doctorId || !date || !addressId) {
    return res.status(400).json({
      status: 'fail',
      message: 'doctorId, date, and addressId are required',
    });
  }
  const slotDate = new Date(date);
  const slots = await DoctorSlotModel.findOne({ doctorId, addressId, date: slotDate });
  if (!slots) {
    return res.status(404).json({
      status: 'fail',
      message: 'No slots found for this doctor on the specified date',
    });
  }
  return res.status(200).json({ status: 'success', data: slots });
};

const AIRTEL_API_URL = "https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/send/text"

const FROM_NUMBER = 919666955501
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
      selectedDate: undefined
    };
  }
  const vydhyoSession = sessions[from];
  let reply = '';

  // 1. City selection
  // Always allow "hi" to restart the session
  if (text.toLowerCase() === 'hi') {
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
      stage: 'city_selection',
      cart: [],
      selectedDate: undefined
    };
    const vydhyoSession = sessions[from];
    try {
      const { data } = await axios.get('https://server.vydhyo.com/whatsapp/cities');
      vydhyoSession.cities = Array.isArray(data?.data) ? data.data : [];
      if ((vydhyoSession.cities ?? []).length > 0) {
        reply = `👋 Welcome to Vydhyo! Please select your city:\n${(vydhyoSession.cities ?? []).map((city, i) => `${i + 1}) ${city}`).join('\n')}`;
      } else {
        reply = `❌ No cities found. Please try again later.`;
      }
    } catch {
      reply = `❌ No cities found. Please try again later.`;
    }
  } else if (!vydhyoSession.city) {
    if (vydhyoSession.cities && Number(text) >= 1 && Number(text) <= vydhyoSession.cities.length) {
      vydhyoSession.city = vydhyoSession.cities[Number(text) - 1];
      vydhyoSession.stage = 'specialization_selection';
      // Get specializations for city
      try {
        const { data } = await axios.get(`https://server.vydhyo.com/whatsapp/specializations`);
        vydhyoSession.specializations = Array.isArray(data?.data) ? data.data : [];
        if ((vydhyoSession.specializations ?? []).length > 0) {
          reply = `You selected ${vydhyoSession.city}. Please select a specialization:\n${(vydhyoSession.specializations ?? []).map((s, i) => `${i + 1}) ${s}`).join('\n')}`;
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
    if (vydhyoSession.specializations && Number(text) >= 1 && Number(text) <= vydhyoSession.specializations.length) {
      vydhyoSession.specialization = vydhyoSession.specializations[Number(text) - 1];
      vydhyoSession.stage = 'doctor_selection';
      // Get doctors for city & specialization
      try {
        const { data } = await axios.get(`https://server.vydhyo.com/whatsapp/doctors-by-specialization-city?city=${encodeURIComponent(vydhyoSession.city)}&specialization=${encodeURIComponent(vydhyoSession.specialization)}`);
        console.log(data);
        vydhyoSession.doctors = Array.isArray(data?.data) ? data.data : [];
        if ((vydhyoSession.doctors ?? []).length > 0) {
          reply = `You selected ${vydhyoSession.specialization}. Please select a doctor:\n${(vydhyoSession.doctors ?? []).map((d, i) => `${i + 1}) ${d.firstname} ${d.lastname}`).join('\n')}`;
        } else {
          reply = `❌ No doctors found for ${vydhyoSession.specialization} in ${vydhyoSession.city}.`;
        }
      } catch {
        reply = `❌ No doctors found. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please select a valid specialization number:\n${vydhyoSession.specializations?.map((s, i) => `${i + 1}) ${s}`).join('\n')}`;
    }
  }
  // 3. Doctor selection
  else if (!vydhyoSession.doctor) {
    if (vydhyoSession.doctors && Number(text) >= 1 && Number(text) <= vydhyoSession.doctors.length) {
      vydhyoSession.doctor = vydhyoSession.doctors[Number(text) - 1];
      vydhyoSession.doctorId = vydhyoSession.doctor.userId;
      // Get clinics for doctor & city
      try {
        const { data } = await axios.get(`https://server.vydhyo.com/whatsapp/doctor-clinics?userId=${vydhyoSession.doctorId}&city=${encodeURIComponent(vydhyoSession.city)}`);
        vydhyoSession.clinics = Array.isArray(data?.data) ? data.data : [];
        if ((vydhyoSession.clinics ?? []).length > 0) {
            reply = `You selected ${vydhyoSession.doctor.firstname} ${vydhyoSession.doctor.lastname}. Please select a clinic:\n${(vydhyoSession.clinics ?? []).map((c, i) => `${i + 1}) ${c.clinicName}`).join('\n')}`;
          vydhyoSession.stage = 'clinic_selection';
        } else {
          reply = `❌ No clinics found for ${vydhyoSession.doctor.firstname} ${vydhyoSession.doctor.lastname} in ${vydhyoSession.city}.`;
        }
      } catch {
        reply = `❌ No clinics found. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please select a valid doctor number:\n${vydhyoSession.doctors?.map((d, i) => `${i + 1}) ${d.firstname} ${d.lastname}`).join('\n')}`;
    }
  }
  // 4. Clinic selection
  else if (!vydhyoSession.clinic) {
    if (vydhyoSession.clinics && Number(text) >= 1 && Number(text) <= vydhyoSession.clinics.length) {
      vydhyoSession.clinic = vydhyoSession.clinics[Number(text) - 1];
      vydhyoSession.addressId = vydhyoSession.clinic.addressId;

      // Generate today + next 3 days
      const dates = [];
      for (let i = 0; i < 4; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dates.push({
          key: `${yyyy}-${mm}-${dd}`,
          display: `${dd}-${mm}-${yyyy}`,
        });
      }
      vydhyoSession.dates = dates.map(date => date.key);

      reply = `You selected clinic: ${vydhyoSession.clinic.address}\nPlease select a date:\n${dates.map((date, i) => `${i + 1}) ${date.display}`).join('\n')}`;
      vydhyoSession.stage = 'date_selection';
    } else {
      reply = `❓ I didn't understand that. Please select a valid clinic number:\n${vydhyoSession.clinics?.map((c, i) => `${i + 1}) ${c.address}`).join('\n')}`;
    }
  }
  // 5. Date selection
  else if (!vydhyoSession.date) {
    if (vydhyoSession.dates && Number(text) >= 1 && Number(text) <= vydhyoSession.dates.length) {
      vydhyoSession.date = vydhyoSession.dates[Number(text) - 1];
      // Get slots for doctorId, addressId, date
      console.log(`https://server.vydhyo.com/whatsappbooking/getSlotsByDoctorIdAndDateForWhatsapp?doctorId=${vydhyoSession.doctorId}&addressId=${vydhyoSession.addressId}&date=${encodeURIComponent(vydhyoSession.date)}`);
      try {
        const { data } = await axios.get(`https://server.vydhyo.com/whatsappbooking/getSlotsByDoctorIdAndDateForWhatsapp?doctorId=${vydhyoSession.doctorId}&addressId=${vydhyoSession.addressId}&date=${encodeURIComponent(vydhyoSession.date)}`);
        // Only keep slots with status 'available' and map to their time
        vydhyoSession.slots = Array.isArray(data?.data?.slots)
          ? data.data.slots.filter((slot) => slot.status === 'available').map((slot) => slot.time)
          : [];
        if ((vydhyoSession.slots ?? []).length > 0) {
          reply = `You selected ${vydhyoSession.date}. Please select a time slot:\n${(vydhyoSession.slots ?? []).map((s, i) => `${i + 1}) ${s}`).join('\n')}`;
          vydhyoSession.stage = 'slot_selection';
        } else {
          reply = `❌ No slots available for this date.`;
        }
      } catch {
        reply = `❌ No slots available. Please try again later.`;
      }
    } else {
      reply = `❓ I didn't understand that. Please select a valid date number:\n${vydhyoSession.dates?.map((d, i) => `${i + 1}) ${d}`).join('\n')}`;
    }
  }
  // 6. Slot selection
  else if (!vydhyoSession.slot) {
    if (vydhyoSession.slots && Number(text) >= 1 && Number(text) <= vydhyoSession.slots.length) {
      vydhyoSession.slot = vydhyoSession.slots[Number(text) - 1];
      reply = `You selected ${vydhyoSession.slot}. Confirm your appointment by replying 'Yes'.`;
      vydhyoSession.stage = 'confirm';
    } else {
      reply = `❓ I didn't understand that. Please select a valid slot number:\n${vydhyoSession.slots?.map((s, i) => `${i + 1}) ${s}`).join('\n')}`;
    }
  }
  // 7. Confirmation
  else if (vydhyoSession.stage === 'confirm' && text.toLowerCase() === 'yes') {
    // Confirm appointment (dummy API call)
    try {
      await axios.post('https://server.vydhyo.com/whatsapp/book', {
        city: vydhyoSession.city,
        specialization: vydhyoSession.specialization,
        doctorId: vydhyoSession.doctorId,
        addressId: vydhyoSession.addressId,
        date: vydhyoSession.date,
        slot: vydhyoSession.slot,
        user: from
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
    console.error('❌ Error sending reply:', error.message);
  }
};
  // Your Vydhyobot implementation here




export const sendWhatsAppMessage = async (
  to,
  reply,
  fromNumber,
  base64Image
) => {
  const username = 'world_tek';
  const password = 'T7W9&w3396Y"'; // Store in environment variables in production
  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };

  const textUrl =
    'https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/send/text';

  const uploadUrl =
    'https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/upload/media';

  const mediaSendUrl =
    'https://iqwhatsapp.airtel.in/gateway/airtel-xchange/basic/whatsapp-manager/v1/session/send/media';

  try {
    // 🔹 If no image, send as text message
    if (!base64Image) {
      const textPayload = {
        sessionId: generateUuid(),
        to,
        from: fromNumber,
        message: {
          type: 'text',
          text: reply,
        },
      };

      const response = await axios.post(textUrl, textPayload, { headers });
      // console.log('✅ Text message sent:', response.data);
      return response.data;
    }

    // 🔹 Clean base64 data (remove prefix if exists)
    const cleanedBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');

    // 🔹 Upload image to get mediaId
    const uploadPayload = {
      sessionId: generateUuid(),
      type: 'image',
      attachment: {
        base64: cleanedBase64,
        filename: 'qr-code.png',
      },
    };

    const uploadRes = await axios.post(uploadUrl, uploadPayload, { headers });
    const mediaId = uploadRes.data.mediaId;

    if (!mediaId) {
      throw new Error('❌ Media upload failed. mediaId not returned.');
    }

    // 🔹 Send image message using mediaId
    const mediaPayload = {
      sessionId: generateUuid(),
      to,
      from: fromNumber,
      message: {
        type: 'image',
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
    console.error('❌ Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
};



export const booking = async (req, res) => {
  console.log("whatsappbot","hello100");

  console.log("whatsappbot",req.body);
// Check if msgStatus is RECEIVED
  if (req.body.msgStatus !== 'RECEIVED') {
    // console.log('Ignoring webhook request as msgStatus is not RECEIVED.');
    return res.status(200).json({ message: 'Webhook ignored.' });
  }

 await vydhyobot(req.body);

  return res.status(200).json({
    status: 'success',
    message: 'Booking done',
  });
};

function generateUuid() {
  return uuidv4();
}