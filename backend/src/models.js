const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: String,
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['citizen', 'admin', 'rto', 'officer'], default: 'citizen' },
  district: String,
  assignedArea: String,
  accountStatus: { type: String, enum: ['active', 'disabled'], default: 'active' },
}, { timestamps: true }));

const STATUSES = ['Submitted', 'Under Review', 'Verified', 'Rejected', 'Assigned to RTO',
  'Assigned to Officer', 'Inspection Pending', 'Inspection Completed', 'Action Taken',
  'Challan Status Updated', 'Resolved', 'Closed', 'Returned for Clarification'];

const Complaint = mongoose.model('Complaint', new Schema({
  complaintId: { type: String, unique: true, index: true },
  trackingPinHash: String,
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', select: false }, // identity kept restricted
  confidential: { type: Boolean, default: true },
  demoData: { type: Boolean, default: false },
  vehicleNumber: String,
  imageReference: String,
  latitude: Number,
  longitude: Number,
  locationAccuracyMeters: Number,
  locationCapturedAt: Date,
  locationType: { type: String, enum: ['photo_capture', 'submission', 'manual'], default: 'submission' },
  locationDescription: String,
  district: String,
  aiAnalysis: Schema.Types.Mixed,
  ocrResult: Schema.Types.Mixed,
  status: { type: String, enum: STATUSES, default: 'Submitted' },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  slaDueAt: Date,
  assignedRtoId: { type: Schema.Types.ObjectId, ref: 'User' },
  policeStation: String,
  assignedOfficerId: { type: Schema.Types.ObjectId, ref: 'User' },
  resolutionDetails: {
    inspectionResult: String, actionTaken: String, challanReference: String,
    challanStatus: String, complianceObservation: String,
  },
  rewardRequested: { type: Boolean, default: false },
  escalated: { type: Boolean, default: false },
  evidenceFiles: [String], // officer-attached evidence
}, { timestamps: { createdAt: 'submittedAt', updatedAt: 'updatedAt' } }));

const PoliceStation = mongoose.model('PoliceStation', new Schema({
  name: { type: String, required: true },
  district: { type: String, required: true },
  area: String,
  latitude: Number,
  longitude: Number,
}));

const ComplaintHistory = mongoose.model('ComplaintHistory', new Schema({
  complaintId: String, previousStatus: String, newStatus: String,
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }, actorRole: String,
  remarks: String, timestamp: { type: Date, default: Date.now },
}));

const Assignment = mongoose.model('Assignment', new Schema({
  complaintId: String, assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, assignmentType: String,
  assignedAt: { type: Date, default: Date.now }, assignmentRemarks: String,
}));

const Notification = mongoose.model('Notification', new Schema({
  recipientId: { type: Schema.Types.ObjectId, ref: 'User' }, complaintId: String,
  title: String, message: String, readStatus: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}));

const AuditLog = mongoose.model('AuditLog', new Schema({
  actorId: Schema.Types.ObjectId, actorRole: String, action: String,
  resourceType: String, resourceId: String, timestamp: { type: Date, default: Date.now },
  metadata: Schema.Types.Mixed,
}));

const RewardRequest = mongoose.model('RewardRequest', new Schema({
  complaintId: String, confidentialRequest: { type: Boolean, default: true },
  eligibilityStatus: { type: String, default: 'pending' },
  reviewStatus: { type: String, default: 'pending' },
  decisionRemarks: String, createdAt: { type: Date, default: Date.now },
}));

const Setting = mongoose.model('Setting', new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }));

module.exports = { PoliceStation, User, Complaint, ComplaintHistory, Assignment, Notification, AuditLog, RewardRequest, Setting, STATUSES };
