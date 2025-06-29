const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
	appointmentId: {
		type: String,
		required: true,
		unique: true
	},
	userId: {
		type: String,
		required: true
	},
	doctorId: {
		type: String,
		required: true
	},
	patientName: {
		type: String,
		default: null
	},
	doctorName: {
		type: String,
		default: null
	},
	appointmentType: {
		type: String,
		required: true
	},
	appointmentDepartment: {
		type: String,
		required: true
	},
	appointmentDate: {
		type: Date,
		required: true
	},
	appointmentTime: {
		type: String,
		required: true
	},
	appointmentReason: {
		type: String,
		required: true
	},
	appointmentStatus: {
		type: String,
		enum: ['pending', 'scheduled', 'completed', 'cancelled', 'rescheduled'],
		default: 'pending'
	},
	appointmentNotes: {
		type: String,
		default: null
	},
	cancellationReason: {
		type: String,
		default: null
	},
	rescheduleHistory: [
		{
			previousDate: { type: Date, required: true },
			previousTime: { type: String, default: null },
			rescheduledDate: { type: Date, required: true },
			rescheduledTime: { type: String, default: null },
			reason: { type: String, default: null }
		}
	],
	isFollowUp: {
		type: Boolean,
		default: false
	},
	followUpFor: {
		type: String,
		default: null
	},
	followUpMetadata: {
		type: {
			type: String,
			enum: ['free', 'paid'],
			default: 'free'
		},
		scheduledBy: {
			type: String,	
			default: null
		}
	},
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
	}
});

module.exports = mongoose.model('appointments', appointmentSchema);
