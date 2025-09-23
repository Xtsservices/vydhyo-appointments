
const axios = require('axios');

// Set base URL from env (or hardcode for dev)
const USER_SERVICE_BASE_URL = process.env.USER_SERVICE_URL;

async function getUserById(userId, authHeader) {
  try {
    const response = await axios.get(`${USER_SERVICE_BASE_URL}/users/getUser?userId=${userId}`, {
      headers: {
        Authorization: authHeader,
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error calling User Service:', error.message);
    throw new Error('Unable to fetch user');
  }
};

async function getUserDetailsBatch(authHeader, bodyParams) {
  try {
    const response = await axios.post(
      `${USER_SERVICE_BASE_URL}/users/getUsersByIds`,
      bodyParams,
      {
        headers: {
          Authorization: authHeader
        }
      }
    );
    return response.data.users; // Assuming the response has a 'users' field
  } catch (error) {
    console.error('Error calling User Service for batch:', error.message);
    throw new Error('Unable to fetch user details in batch');
  }
};


const getUsersByIds = async (userIds) => {
  try {
    const resp = await axios.post(
      `${USER_SERVICE_BASE_URL}/users/getUsersByIds`,
      { userIds },
      { headers: { "Content-Type": "application/json" } }
    );

    const usersArray = resp?.data?.users || [];
    const usersMap = {};

    usersArray.forEach(u => {
      usersMap[u.userId] = u; // store by userId for easy access
    });

    return usersMap;
  } catch (err) {
    console.error("Error fetching user details:", err.message);
    return {};
  }
};

async function getMinimalUser(userId, authHeader) {
  try {
    const response = await axios.get(`${USER_SERVICE_BASE_URL}/users/getUserMinimalData?userId=${userId}`, {
      headers: { Authorization: authHeader },
    });
    return response.data.data; // contains { firstname, lastname, fcmToken }
  } catch (err) {
    console.error('Error fetching minimal user:', err.message);
    throw new Error('Unable to fetch user');
  }
}


module.exports = {
  getUserById,
  getUserDetailsBatch,
  getUsersByIds,
  getMinimalUser
};
