const { Complaint, User } = require('./models');
const { notify, isOverdue } = require('./workflow');

// Escalation: complaints past SLA are flagged and supervisors (admins) are notified once.
// Assigned officer/RTO get a reminder at most once per day.
async function runSlaSweep(now = new Date()) {
  const open = await Complaint.find({ status: { $nin: ['Resolved', 'Closed', 'Rejected'] }, slaDueAt: { $lt: now } });
  const admins = await User.find({ role: 'admin', accountStatus: 'active' });
  let escalated = 0;
  for (const c of open.filter(isOverdue)) {
    await notify(c.assignedOfficerId || c.assignedRtoId, c.complaintId, 'Complaint overdue', `${c.complaintId} has passed its SLA target`);
    if (!c.escalated) {
      c.escalated = true;
      await c.save();
      escalated++;
      await Promise.all(admins.map((a) => notify(a._id, c.complaintId, 'Escalation', `${c.complaintId} is overdue and escalated for supervisor review`)));
    }
  }
  return { overdue: open.length, escalated };
}

module.exports = { runSlaSweep };
