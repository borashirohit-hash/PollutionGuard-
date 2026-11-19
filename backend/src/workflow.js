const { Complaint, ComplaintHistory, Notification, Setting } = require('./models');

// Valid status transitions (workflow enforcement)
const TRANSITIONS = {
  'Submitted': ['Under Review', 'Rejected'],
  'Under Review': ['Verified', 'Rejected', 'Returned for Clarification'],
  'Returned for Clarification': ['Under Review', 'Rejected'],
  'Verified': ['Assigned to RTO', 'Assigned to Officer', 'Rejected'],
  'Assigned to RTO': ['Assigned to Officer', 'Rejected', 'Returned for Clarification'],
  'Assigned to Officer': ['Inspection Pending', 'Returned for Clarification'],
  'Inspection Pending': ['Inspection Completed', 'Returned for Clarification'],
  'Inspection Completed': ['Action Taken', 'Resolved', 'Returned for Clarification'],
  'Action Taken': ['Challan Status Updated', 'Resolved'],
  'Challan Status Updated': ['Resolved'],
  'Resolved': ['Closed', 'Returned for Clarification'],
  'Rejected': ['Closed'],
  'Closed': [],
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

async function slaDays() {
  const s = await Setting.findOne({ key: 'slaDays' });
  return s ? Number(s.value) : Number(process.env.SLA_DAYS || 7);
}

async function changeStatus(complaint, newStatus, user, remarks) {
  if (!canTransition(complaint.status, newStatus)) {
    const err = new Error(`Invalid transition: ${complaint.status} -> ${newStatus}`);
    err.status = 400;
    throw err;
  }
  const prev = complaint.status;
  complaint.status = newStatus;
  await complaint.save();
  await ComplaintHistory.create({
    complaintId: complaint.complaintId, previousStatus: prev, newStatus,
    updatedBy: user?._id, actorRole: user?.role, remarks,
  });
  // Notify a logged-in (non-anonymous) reporter of every status change
  const withReporter = await Complaint.findById(complaint._id).select('+reporterId');
  if (withReporter?.reporterId && newStatus !== prev) {
    await Notification.create({ recipientId: withReporter.reporterId, complaintId: complaint.complaintId, title: 'Status updated', message: `Complaint ${complaint.complaintId} is now: ${newStatus}` });
  }
  return prev;
}

const notify = (recipientId, complaintId, title, message) =>
  recipientId ? Notification.create({ recipientId, complaintId, title, message }) : null;

const isOverdue = (c) =>
  c.slaDueAt && c.slaDueAt < new Date() && !['Resolved', 'Closed', 'Rejected'].includes(c.status);

module.exports = { TRANSITIONS, canTransition, changeStatus, notify, slaDays, isOverdue };
