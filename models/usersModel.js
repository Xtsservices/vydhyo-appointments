const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  role: String,
  email: {
    type: String,
    lowercase: true,
    trim: true
  },
  specialization: {
    id: { type: String,   },
    name: { type: String,   },
    experience: { type: Number,   },
    degree: { type: String }, // Added for degree (e.g., MBBS, MD)
    services: { type: String, default: '' }, // Added for services, optional
    bio: { type: String, default: '' },
    drgreeCertificate: {
      mimeType: String,
      data: String,
    },
    specializationCertificate: {
      mimeType: String,
      data: String,
    },
  },
  medicalRegistrationNumber: { type: String,   },
  mobile: {
    type: String,
    lowercase: true,
    trim: true
  },  
  userId: {
    type: String,
    required: true
     
  },
  status: {
    type: String,
    default: 'inActive'
  },
  consultationModeFee: [{
    type: { type: String,   },
    fee: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' }
  }],
  bankDetails: {
    accountNumber: { type: String, default: null },
    ifscCode: { type: String, default: null },
    bankName: { type: String, default: null },
    accountHolderName: { type: String, default: null }
  },
  refreshToken: { type: String },
  spokenLanguage: {
    type: [String],
    default: [],
  },
  appLanguage: {
    type: String,
    enum: ['en', 'hi', 'tel'],
    default: 'en'
  },
  relationship: {
    type: String,
    enum: ['parent', 'child', 'self', 'other'],
    default: 'self'
  },
  profilepic: {
    mimeType: String,
    data: String,
  },
  gender: {
    type: String,
    default: null
  },
  DOB: {
    type: String,
    default: null
  },
  bloodgroup: {
    type: String,
    default: null
  },
  maritalStatus: {
    type: String,
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  rejectionReason:{ type: String,default:null},
  createdBy: {
    type: String,
    default: null
  },
  updatedBy: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: null
  },
  isLoggedIn: {
    type: Boolean,
    default: false
  },
  lastLogout: {
    type: Date,
    default: null
  },
  access: {
    type: [String],
    default: []
  },
   fcmToken: {
    type: String,
    default: null,
  },
});

module.exports = mongoose.model('User', userSchema);