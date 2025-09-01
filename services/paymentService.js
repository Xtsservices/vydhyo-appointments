const axios = require('axios');

// Set base URL from env (or hardcode for dev)
const FINANCE_SERVICE_BASE_URL = process.env.FINANCE_SERVICE_URL;



async function updateWhatsAppPaymentStatus(bodyParams) {
  try {
    const response = await axios.post(
      `${FINANCE_SERVICE_BASE_URL}/finance/updateWhatsAppPaymentStatus`,
      bodyParams,
    );
    return response.data;
  } catch (error) {
    console.log('Error calling Payment Service:', error.message);
    throw new Error('Unable to create payment');
  }
}

async function createWhatsAppPayment(bodyParams) {
  try {
    const response = await axios.post(
      `${FINANCE_SERVICE_BASE_URL}/finance/createPayment`,
      bodyParams,
    );
    return response.data;
  } catch (error) {
    console.log('Error calling Payment Service:', error.message);
    throw new Error('Unable to create payment');
  }
}

async function createPayment(authHeader, bodyParams) {
  try {
    const response = await axios.post(
      `${FINANCE_SERVICE_BASE_URL}/finance/createPayment`,
      bodyParams,
      {
        headers: {
          Authorization: authHeader
        }
      }
    );
    return response.data;
  } catch (error) {
    console.log('Error calling Payment Service:', error.message);
    throw new Error('Unable to create payment');
  }
}

async function getAppointmentPayments(authHeader, bodyParams) {
  try {
    const response = await axios.post(
      `${FINANCE_SERVICE_BASE_URL}/finance/getAppointmentPayments`,
      bodyParams,
      {
        headers: {
          Authorization: authHeader
        }
      }
    );
    return response.data;
  } catch (error) {
    console.log('Error calling Payment Service:', error.message);
    throw new Error('Unable to fetch payment');
  }
}

async function updatePayment(authHeader, bodyParams) {
  try {
    const response = await axios.put(
      `${FINANCE_SERVICE_BASE_URL}/finance/updatePaymentByAppointment`,
      bodyParams,
      {
        headers: {
          Authorization: authHeader
        }
      }
    );
    return response.data;
  } catch (error) {
    console.log('Error calling Payment Service:', error.message);
    throw new Error('Unable to fetch payment');
  }
}

module.exports = {
  createPayment,
  getAppointmentPayments,
  updatePayment,
  createWhatsAppPayment,
  updateWhatsAppPaymentStatus
};
