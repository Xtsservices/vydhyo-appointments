const axios = require("axios");

const sendSMS = async (params) => {
  try {
    const url = "http://wecann.in/v3/api.php";

    // Trigger the API using axios
    const response = await axios.get(url, { params });
console.log("SMS API response:", response.data);
    return response.data; // Return the API response
  } catch (error) {
    console.error("Error sending SMS:", error);
    throw new Error("Failed to send SMS");
  }
};

const sendOTPSMS = async (mobile, codeOrMessage, templateid) => {
    const defaultTemplate =
    "Dear {#var#} Kindly use this {#var#} otp For Login . thank You For choosing - Vydhyo";

  const template =  defaultTemplate;
  // Function to populate the template with dynamic values
  function populateTemplate(template, values) {
    let index = 0;
    return template.replace(/{#var#}/g, () => values[index++]);
  }

  // Populate the template with the user's name and OTP
  const name = "user"; // Default name for the user
 const message = populateTemplate(template, [name, codeOrMessage]);

  try {
    const params = {
      username: "VYDHYO",
      apikey: process.env.SMSAPIKEY, // Use API key from environment variables
      senderid: "VYDHYO",
      mobile: mobile,
      message: codeOrMessage,
      templateid: templateid,
    };
    console.log("SMS params:", params);
    // Call the sendSMS function
    return await sendSMS(params);
  } catch (error) {
    console.error("Error sending OTP SMS:", error);
    throw new Error("Failed to send OTP SMS");
  }
};

module.exports = {
  sendOTPSMS,
  sendSMS,
};