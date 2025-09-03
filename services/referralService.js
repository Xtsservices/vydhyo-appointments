const axios = require('axios');

async function creditReferralReward(appointment, rewardAmount) {
  try {
    // Step 1: Fetch referral details from users service
    const referralResp = await axios.get(
      `http://localhost:4001/auth/referral/${appointment.referralCode}/${appointment.appointmentId}`,
       {
        headers: {
          'Content-Type': 'application/json',
          // Authorization: req.headers.authorization || ''
        },
      }
    );
console.log("Referral response:", referralResp.data);
    const referral = referralResp.data?.data;
    if (!referral) {
      throw {
      statusCode: 404,
      message: `Referral not found for code: ${appointment.referralCode} and appointment ID: ${appointment.appointmentId}`,
    };
    }
console.log("Referral details:", referral);
    // Step 2: Validate referral
    if (
    referral.appointmentId !== appointment.appointmentId ||
      referral.status !== 'completed' ||
      referral.rewardIssued
    ) {
      throw {
      statusCode: 400,
      message: `Referral ineligible for reward: code=${appointment.referralCode}, userId=${appointment.userId}, appointmentId=${appointment.appointmentId}, status=${referral.status}, rewardIssued=${referral.rewardIssued}`,
    };
    }

    console.log("Referral is valid and eligible for reward.");
    // Step 3: Create wallet transaction in payments service
    const transactionResponse = await axios.post(
      'http://localhost:4003/wallet/createWalletTransaction',
      {
        customerID: referral.referredBy,
        transactionID: `REF_REWARD_${referral.referralCode}_${Date.now()}`,
        amount: rewardAmount,
        transactionType: 'credit',
        purpose: 'referral_reward',
        description: `Reward for referral code ${referral.referralCode} on appointment ${appointment.appointmentId}`,
        currency: 'INR',
        appointmentId: appointment.appointmentId,
        status: 'approved',
        createdAt: Date.now(),
        createdBy: 'system',
        updatedAt: Date.now(),
        updatedBy: 'system',
        statusHistory: [
          {
            note: `Reward credited for referral ${referral.referralCode}`,
            status: 'approved',
            updatedAt: Date.now(),
            updatedBy: 'system',
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          // Authorization: req.headers?.authorization || '',
        },
      }
    );
    console.log("Transaction response:", transactionResponse.data);
    if (transactionResponse.data?.status !== 'success') {
      throw {
      statusCode: 500,
      message: `Failed to create wallet transaction: ${transactionResponse.data?.message || 'Unknown error'}`,
    };
    }

    console.log("Wallet transaction created successfully.");
    // Step 4: Update referral status to rewarded in users service
    const referralUpdateResp = await axios.patch(
      `http://localhost:4001/auth/referralCode/${appointment.referralCode}/${appointment.appointmentId}`,
      { status: 'rewarded', rewardIssued: true },
      {
        headers: {
          'Content-Type': 'application/json',
          // Authorization: req.headers?.authorization || '',
        },
      }
    );
    console.log("Referral update response:", referralUpdateResp.data);
    if (referralUpdateResp.data?.status !== 'success') {
      throw {
      statusCode: 500,
      message: `Failed to update referral status: ${referralUpdateResp.data?.message || 'Unknown error'}`,
    };
    }

    console.log(
      `Reward of ${rewardAmount} INR credited to user ${referral.referredBy} wallet for referral ${referral.referralCode}`
    );
    return true;
  } catch (error) {
    console.log("Error details:", error);
    console.error('Error in creditReferralReward:', error.message);
    return false;
  }
}


module.exports = {
  creditReferralReward,
 
};